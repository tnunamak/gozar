import { posix as path } from 'node:path';

const smoke = 'test/node/error-normalizer.test.mjs';
const moduleFile = /\.(?:[cm]?js|[cm]?ts|json)$/u;
const nodeTest = /(?:^|\/)test\/.*\.test\.[cm]?js$/u;
const docs = /(?:^|\/)(?:README|CHANGELOG|INSTALL)(?:\.[^/]+)?$|^docs\//iu;
const core = /^crates\/gozar-core\/|^packages\/gozar-core\/generated\//u;
const buildInput = /^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.cargo\/.*|scripts\/build-wasm\.sh)$/u;
const installedDoc = /(?:^|\/)[^/]*(?:package|operator-walk)[^/]*\.test\.[cm]?js$/iu;
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
  const allTests = [...present].filter(file => nodeTest.test(file)).sort();
  const known = new Set([...present, ...changed]);
  const reverse = new Map();
  const forward = new Map();
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
      fallback = true;
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
    catch { opaque = true; continue; }
    if (typeof source !== 'string') { opaque = true; continue; }

    // Match direct imports, re-exports and literal loader calls. Anything
    // nonliteral goes through conservative fallback, not a guessed edge.
    const refs = [
      ...source.matchAll(/\b(?:from|import)\s*['"]([^'"\r\n]+)['"]/gu),
      ...source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/gu),
    ];
    const calls = [...source.matchAll(/\b(?:import|require)\s*\(/gu)].length;
    if (calls > [...source.matchAll(/\b(?:import|require)\s*\(\s*['"][^'"\r\n]+['"]\s*\)/gu)].length)
      opaque = true;
    for (const [, spec] of refs) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        if (spec === '@tnunamak/gozar' || spec.startsWith('@tnunamak/gozar/'))
          opaque = true;
        continue;
      }
      for (const target of localTargets(file, spec, known)) {
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
    const docTests = allTests.filter(file => installedDoc.test(file));
    if (!docTests.length) fallback = true;
    for (const file of docTests) selected.add(file);
  }
  if (fallback) for (const file of allTests) selected.add(file);

  const closure = [...selected];
  const walked = new Set();
  let needsCore = fallback || coreChanged;
  while (closure.length) {
    const file = closure.pop();
    if (walked.has(file)) continue;
    walked.add(file);
    if (core.test(file)) needsCore = true;
    for (const dependency of forward.get(file) ?? []) closure.push(dependency);
  }
  return {
    nodeTests: [...selected].sort(),
    rustPackages: rust ? ['gozar-core'] : [],
    buildWasm: needsCore && (coreChanged || !generated.every(file => present.has(file))),
    full: Boolean(full),
  };
}
