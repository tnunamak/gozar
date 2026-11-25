import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix as path, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const smoke = 'test/node/error-normalizer.test.mjs';
const moduleFile = /\.(?:[cm]?js|[cm]?ts|json)$/u;
const nodeTest = /(?:^|\/)test\/.*\.test\.[cm]?js$/u;
const canonicalTestFamily = /^test\/(?:node|adapters)\//u;
const docs = /(?:^|\/)(?:README|CHANGELOG|INSTALL)(?:\.[^/]+)?$|^docs\//iu;
const core = /^crates\/gozar-core\/|^packages\/gozar-core\/generated\//u;
const buildInput = /^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.cargo\/.*|scripts\/build-wasm\.sh)$/u;
const installedDoc = ['test/node/package.test.mjs', 'test/node/live-provider-walk-doc.test.mjs'];
const generated = [
  'packages/gozar-core/generated/gozar_core.js',
  'packages/gozar-core/generated/gozar_core_bg.wasm',
  'packages/gozar-core/generated/package.json',
];

function clean(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') ||
      value.includes('\\') || value.split('/').includes('..')) {
    throw new Error('invalid repository-relative path');
  }
  const result = path.normalize(value);
  if (result === '.') throw new Error('expected a file path');
  return result;
}

function localTargets(file, spec, known) {
  const target = path.normalize(path.join(path.dirname(file), spec));
  const matches = [target, ...(!path.extname(target)
    ? ['.mjs', '.js', '.cjs', '.ts', '.json', '/index.mjs', '/index.js']
        .map(suffix => target + suffix)
    : [])].filter(candidate => known.has(candidate));
  return matches.length ? matches : [target];
}

/**
 * Pure selection only. The caller must pass repository-relative discovered paths
 * (including generated outputs when present); changedPaths should include both
 * sides of renames. No command is executed here.
 */
export function planChecks({ changedPaths, files, readSource, full = false }) {
  if (!Array.isArray(changedPaths) || !Array.isArray(files) ||
      typeof readSource !== 'function') throw new Error('invalid planner arguments');
  const present = new Set(files.map(clean));
  const changed = new Set(changedPaths.map(clean));
  if ((!full && !changed.size) || !present.has(smoke))
    throw new Error('no changed paths or missing required smoke test');
  // Full integration preserves the registered gate's recursive Node families.
  // Patch mode can also select a changed acceptance or e2e test explicitly.
  const allTests = [...present].filter(file => nodeTest.test(file) &&
    (!full || canonicalTestFamily.test(file))).sort();
  const known = new Set([...present, ...changed]);
  const reverse = new Map();
  const forward = new Map();
  const opaqueModules = new Set();
  let opaque = false;
  let fallback = full;
  let rust = full;
  let docsChanged = false;
  let coreChanged = false;
  const selected = new Set([smoke]);
  const impact = [...changed];

  for (const file of changed) {
    if (buildInput.test(file) || core.test(file)) {
      rust = true;
      coreChanged = true;
      // Workspace/build-system edits are global; ordinary core changes are not.
      if (buildInput.test(file)) fallback = true;
    } else if (file === 'package.json' || docs.test(file)) {
      docsChanged = true;
      // A pure planner has no before/after package document: it cannot prove
      // package.json is a version-only edit, so retain full Node coverage.
      if (file === 'package.json') fallback = true;
    } else if (!moduleFile.test(file) ||
        !/^(?:packages|adapters|runtime|test|bin|scripts|harness)\//u.test(file) ||
        /^(?:scripts|bin|runtime)\//u.test(file)) {
      fallback = true;
    }
    if (nodeTest.test(file)) {
      if (present.has(file)) selected.add(file);
      else fallback = true;
    }
  }

  for (const file of present) {
    if (!moduleFile.test(file) || file.endsWith('.json') ||
        file.startsWith('packages/gozar-core/generated/')) continue;
    let source;
    try { source = readSource(file); }
    catch { opaque = true; opaqueModules.add(file); continue; }
    if (typeof source !== 'string') { opaque = true; opaqueModules.add(file); continue; }

    // Match imports, re-exports, loader calls and module-relative file URLs. Anything
    // nonliteral goes through conservative fallback, not a guessed edge.
    const refs = [
      ...source.matchAll(/\b(?:from|import)\s*['"]([^'"\r\n]+)['"]/gu),
      ...source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/gu),
      ...source.matchAll(/\bnew\s+URL\s*\(\s*['"]([^'"\r\n]+)['"]\s*,\s*import\.meta\.url\s*\)/gu),
    ];
    const calls = [...source.matchAll(/\b(?:import|require)\s*\(/gu)].length;
    if (calls > [...source.matchAll(/\b(?:import|require)\s*\(\s*['"][^'"\r\n]+['"]\s*\)/gu)].length)
      { opaque = true; opaqueModules.add(file); }
    for (const [, spec] of refs) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        if (spec === '@tnunamak/gozar' || spec.startsWith('@tnunamak/gozar/')) {
          opaque = true;
          opaqueModules.add(file);
        }
        continue;
      }
      for (const target of localTargets(file, spec, known)) {
        if (!known.has(target)) { opaque = true; opaqueModules.add(file); }
        if (!forward.has(file)) forward.set(file, new Set());
        forward.get(file).add(target);
        if (!reverse.has(target)) reverse.set(target, new Set());
        reverse.get(target).add(file);
      }
    }
  }

  const sourceChange = [...changed].some(file => moduleFile.test(file) && !nodeTest.test(file));
  if (sourceChange && opaque) fallback = true;
  const visited = new Set();
  while (impact.length) {
    const file = impact.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (nodeTest.test(file) && present.has(file)) selected.add(file);
    for (const dependent of reverse.get(file) ?? []) impact.push(dependent);
  }
  // An unreferenced source change is not evidence that there are no consumers:
  // subprocess, runtime config and fixture readers can sit outside the graph.
  if ([...changed].some(file => moduleFile.test(file) && !nodeTest.test(file) &&
      !reverse.has(file))) fallback = true;
  if (docsChanged) {
    for (const file of installedDoc) {
      if (!present.has(file)) throw new Error('missing documentation check: ' + file);
      selected.add(file);
    }
  }
  if (fallback) {
    for (const file of allTests) if (canonicalTestFamily.test(file)) selected.add(file);
  }

  function mayUseCore(root) {
    const stack = [root];
    const walked = new Set();
    while (stack.length) {
      const file = stack.pop();
      if (walked.has(file)) continue;
      walked.add(file);
      // Packaging verifies generated artifacts through a child command, not an import.
      if (file === installedDoc[0] || core.test(file) || opaqueModules.has(file)) return true;
      for (const dependency of forward.get(file) ?? []) stack.push(dependency);
    }
    return false;
  }
  if (coreChanged) {
    for (const file of allTests) {
      if (mayUseCore(file) || /(?:^|[/.\-])(?:core|wasm)(?:[.\-]|$)/u.test(file))
        selected.add(file);
    }
  }
  const needsCore = fallback || coreChanged || [...selected].some(mayUseCore);
  return {
    nodeTests: [...selected].sort(),
    rustPackages: rust ? ['gozar-core'] : [],
    needsCore,
    // A generated file existing is not evidence that it matches the source.
    buildWasm: needsCore,
    full: Boolean(full),
  };
}

const ignoredDirectories = new Set([
  '.git', 'node_modules', '.worktrees', 'build', 'target', 'dist', 'coverage',
]);
const generatedDirectory = 'packages/gozar-core/generated';

export function discoverFiles(root) {
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const file = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && file !== generatedDirectory) walk(file);
        else if (file === generatedDirectory) {
          const names = readdirSync(join(root, file), { withFileTypes: true });
          for (const name of names) {
            const candidate = file + '/' + name.name;
            if (name.isFile() && generated.includes(candidate)) files.push(candidate);
          }
        }
      } else if (entry.isFile()) files.push(file);
    }
  }
  walk('');
  return files.sort();
}

function parseOptions(args, batchBase) {
  let base = 'HEAD', explicit = false, full = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full' && !full) full = true;
    else if (args[i] === '--base' && !explicit) {
      const value = args[++i];
      if (!/^[a-f0-9]{7,64}$/iu.test(value ?? '')) throw new Error('--base requires a commit SHA');
      base = value;
      explicit = true;
    } else {
      throw new Error('invalid option: ' + args[i]);
    }
  }
  const batchDeclared = batchBase !== undefined && batchBase !== null;
  if (!explicit && !full && batchDeclared) {
    if (typeof batchBase !== 'string' || !/^[a-f0-9]{7,64}$/iu.test(batchBase))
      throw new Error('DOT_LAND_BATCH_BASE requires a commit SHA');
    base = batchBase;
  }
  return { base, full, expectsChanges: !full && (explicit || batchDeclared) };
}

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    shell: false,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Injectable command boundary; patch mode requires indexed or committed inputs. */
export function runPatchCheck(args, {
  root = process.cwd(),
  batchBase = process.env.DOT_LAND_BATCH_BASE,
  run = runCommand,
  discover = discoverFiles,
  readSource = file => readFileSync(join(root, file), 'utf8'),
  log = line => console.log(line),
  fail = line => console.error(line),
  now = Date.now,
} = {}) {
  try {
    const { base, full, expectsChanges } = parseOptions(args, batchBase);
    const diff = run('git', ['diff', '--name-only', '-z', '--no-renames', base, '--'],
      { cwd: root, capture: true });
    if (!diff || diff.error || diff.signal || diff.status !== 0 ||
        typeof diff.stdout !== 'string' || (diff.stdout && !diff.stdout.endsWith('\0'))) {
      fail('Cannot establish changed paths for ' + base);
      return Number.isInteger(diff?.status) && diff.status > 0 ? diff.status : 1;
    }
    const changedPaths = diff.stdout ? diff.stdout.slice(0, -1).split('\0') : [];
    if (!full) {
      const extra = run('git', ['ls-files', '--others', '--exclude-standard', '-z'],
        { cwd: root, capture: true });
      if (!extra || extra.error || extra.signal || extra.status !== 0 ||
          typeof extra.stdout !== 'string' ||
          (extra.stdout && (!extra.stdout.endsWith('\0') ||
            extra.stdout.startsWith('\0') || extra.stdout.includes('\0\0')))) {
        fail('Cannot establish untracked paths');
        return Number.isInteger(extra?.status) && extra.status > 0 ? extra.status : 1;
      }
      if (extra.stdout) throw new Error('Untracked paths: stage all patch inputs or use a clean checkout');
    }
    if (!changedPaths.length && !full) {
      const commits = [];
      for (const ref of [base, 'HEAD']) {
        const commit = run('git', ['rev-parse', '--verify', ref + '^{commit}'],
          { cwd: root, capture: true });
        const value = typeof commit?.stdout === 'string' ? commit.stdout.trim() : '';
        if (!commit || commit.error || commit.signal || commit.status !== 0 ||
            !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(value))
          throw new Error('Cannot resolve comparison commit: ' + ref);
        commits.push(value);
      }
      const comparison = 'base=' + commits[0] + ' head=' + commits[1];
      if (expectsChanges) throw new Error('Expected changed paths: ' + comparison);
      log('GOZAR_PATCH_RESULT=noop reason=no-changed-paths ' + comparison);
      return 0;
    }
    const files = discover(root);
    const plan = planChecks({ changedPaths, files, readSource, full });
    const commands = [];
    if (plan.buildWasm) {
      if (!files.includes('scripts/build-wasm.sh')) throw new Error('missing scripts/build-wasm.sh');
      commands.push(['bash', ['scripts/build-wasm.sh']]);
    }
    commands.push([process.execPath, ['--test', '--test-concurrency=1', ...plan.nodeTests]]);
    const rustArgs = ['--locked', '--offline', '--', '--test-threads=1'];
    if (plan.full) commands.push(['cargo', ['test', '--workspace', ...rustArgs]]);
    else for (const name of plan.rustPackages) commands.push(['cargo', ['test', '-p', name, ...rustArgs]]);
    log('Node checks: ' + JSON.stringify(plan.nodeTests));
    log('Rust checks: ' + (plan.full ? 'workspace' : JSON.stringify(plan.rustPackages)));
    for (const [command, commandArgs] of commands) {
      const started = now();
      const result = run(command, commandArgs, { cwd: root, capture: false });
      const elapsed = Math.max(0, now() - started);
      log(command + ' ' + JSON.stringify(commandArgs) + ': ' + elapsed + ' ms');
      if (!result || result.error || result.signal || result.status !== 0) {
        fail('Check failed: ' + command);
        return Number.isInteger(result?.status) && result.status > 0 ? result.status : 1;
      }
    }
    return 0;
  } catch (error) {
    fail('Patch check: ' + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = runPatchCheck(process.argv.slice(2));
