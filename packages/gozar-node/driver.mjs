import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { PrivateFiles } from './private-files.mjs';
import { basename } from 'node:path';
import { admitPlanEffect, expandPlan } from './plan.mjs';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { isPublicIp } from './public-relay.mjs';
import { safeOrigin } from './catalog.mjs';
import { selectedInterfaceAddress } from './interfaces.mjs';
import { loadCore } from './core.mjs';
import { materializePrivateBinding, privateMaterializationScope } from './materialization.mjs';
import { attributable, processIdentity } from './journal.mjs';

const mutates = effect => ['create', 'remove'].includes(effect.operation);
const allowedFields = {
  spawn: ['program', 'args', 'timeoutMs', 'maxOutputBytes', 'longRunning', 'persistent', 'collectMs', 'lifetimeMs'],
  'read-file': ['handleRef', 'maxOutputBytes', 'timeoutMs'],
  'http-probe': ['tls', 'probe', 'nonceRef', 'verifierRef', 'expiresAtMs', 'url', 'vantage', 'timeoutMs', 'maxOutputBytes', 'sse', 'streamableHttp', 'oauthDcr'],
  interfaces: ['timeoutMs', 'maxOutputBytes'],
  timer: ['delayMs', 'timeoutMs', 'maxOutputBytes'],
  'owned-process': ['signal', 'graceMs', 'thenSignal', 'confirmExit', 'timeoutMs', 'maxOutputBytes', 'afterExit', 'cleanupPrivateArtifacts'],
  'local-forwarder': ['targetPort', 'targetHost', 'bindAddress', 'port', 'timeoutMs', 'maxOutputBytes'],
};
const runtimeFields = new Set(['id', 'sessionId', 'generation', 'operation', 'adapterId', 'resourceId', 'origin', 'recipeRef', 'stepId', 'stage', 'bindings', 'bindingRefs', 'ownership']);
const shellPrograms = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);
const bounded = (number, fallback, maximum) => Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class EffectDriver {
  constructor({ adapters, journal, sessionId, targetPort, origin, consent = false, handles = {}, bindAddresses = [], firewallApproved = false, recoveryOnly = false, resolveCredential, observeProcessOutput = false, onProcessOutput, host = { features: [], bindings: {}, facts: {} }, onExit = () => {} }) {
    this.adapters = structuredClone(adapters);
    this.host = host;
    this.privateFiles = new PrivateFiles({ journal, sessionId, resolveCredential });
    this.journal = journal;
    this.sessionId = sessionId;
    this.targetPort = targetPort;
    this.origin = origin;
    this.consent = consent;
    this.handles = handles;
    this.bindAddresses = bindAddresses;
    this.firewallApproved = firewallApproved;
    this.onExit = onExit;
    this.observeProcessOutput = observeProcessOutput; this.onProcessOutput = onProcessOutput;
    this.outputEvents = []; this.outputBytes = 0; this.outputSequence = 0;
    this.recoveryOnly = recoveryOnly;
    this.children = new Map();
    this.routeLineBuffers = new Map();
    this.routeOutputReady = new Set();
    this.forwarders = new Map();
    this.receipts = new Map();
    this.intentRecords = new Map();
    this.timers = new Map();
    this.probeControllers = new Set();
    this.activeRequests = new Set();
    this.proofExpiries = new Map();
    this.generation = 0;
    this.selectedAdapter = null;
    this.stopped = false;
    this.issued = new Set();
  }
  async materializePrivateFile(adapterId, bindingName, { generation } = {}) {
    const adapter = this.adapters.find(item => item.id === adapterId);
    if (adapter?.planVersion !== 1 || adapter.admission?.state !== 'admitted' ||
        !adapter.admission.requiredFeatures.every(feature => this.host.features.includes(feature)) || !this.host.features.includes('private-file-materialization')) throw new Error('Private materialization feature admission failed');
    const bindings = { ...this.host.bindings };
    for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
      if (Object.hasOwn(spec, 'value')) bindings[name] = { type: spec.type, value: spec.value, authorityRef: `plan:${generation}:${name}` };
    }
    const receipt = await materializePrivateBinding({ spec: adapter.bindings?.[bindingName], bindings, facts: this.host.facts ?? {},
      sessionId: this.sessionId, generation, nowMs: this.nowMs(), files: this.privateFiles, adapterId, bindingName });
    if (receipt.expiresAtMs <= this.nowMs()) {
      await this.privateFiles.remove(receipt.handleRef);
      throw new Error('Private materialization authority expired while resolving');
    }
    this.host.bindings[bindingName] = receipt;
    return receipt;
  }
  processOutput(effect, resource, stream, chunk) {
    if (resource?.privateMaterialized) return;
    if (!resource || (!this.observeProcessOutput && !this.onProcessOutput)) return;
    const output = chunk.subarray(Math.max(0,chunk.length-8192)).toString('utf8');
    const event = { sequence:++this.outputSequence, sessionId:this.sessionId, generation:resource.generation,
      adapterId:resource.adapterId, resourceId:resource.id, continuityRef:resource.continuityRef,
      effectId:effect.id, stream, observedAtMs:this.nowMs(), output };
    if (this.observeProcessOutput) {
      this.outputEvents.push(event); this.outputBytes += Buffer.byteLength(output);
      while (this.outputEvents.length > 128 || this.outputBytes > 32768) this.outputBytes -= Buffer.byteLength(this.outputEvents.shift().output);
    }
    if (this.onProcessOutput) {
      const key = `${resource.id}\0${stream}`;
      const frame = this.routeLineBuffers.get(key) ?? { buffer: '', dropping: false };
      for (const char of chunk.toString('utf8')) {
        if (char === '\n') {
          const line = frame.buffer.endsWith('\r') ? frame.buffer.slice(0, -1) : frame.buffer;
          if (!frame.dropping && line.length <= 4096) {
            if (this.routeOutputReady.has(resource.id)) { try { this.onProcessOutput({ ...event, completeLine: line }); } catch {} }
          }
          frame.buffer = ''; frame.dropping = false;
        } else if (!frame.dropping) {
          if (frame.buffer.length >= 4096) { frame.buffer = ''; frame.dropping = true; }
          else frame.buffer += char;
        }
      }
      this.routeLineBuffers.set(key, frame);
      try { this.onProcessOutput(event); } catch {}
    }
  }
  readProcessOutput(after = 0) { return this.outputEvents.filter(event=>event.sequence>after).map(event=>({...event})); }
  nowMs() { return Math.floor(performance.timeOrigin + performance.now()); }
  planContext() { return { adapters: this.adapters, sessionId: this.sessionId, targetPort: this.targetPort,
    features: this.host.features, host: this.host, nowMs: this.nowMs(), owned: this.journal.value.owned }; }
  payloadKey(value, bindings = value.bindings) {
    const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object' ?
      Object.fromEntries(Object.keys(item).sort().filter(key => key !== 'parser').map(key => [key, canonical(item[key])])) : item;
    const payload = Object.fromEntries(Object.entries(value).filter(([key]) => !runtimeFields.has(key)));
    return JSON.stringify(canonical({ payload, bindings: bindings ?? {} }));
  }
  receiptKey(effect) { return JSON.stringify([effect.sessionId, effect.generation, effect.adapterId, effect.operation, effect.resourceId ?? null]); }
  authorize(adapterId) { this.selectedAdapter = adapterId; this.consent = true; }
  expand(value, effect) {
    if (typeof value === 'string') return value.replace(/\{([A-Za-z]+)\}/g, (_, key) => {
      const binding = effect.bindings?.[key];
      if (binding) return binding.type === 'session-private-path' ? `{${key}}` : String(binding.value ?? binding.handleRef);
      const fields = { port: this.targetPort, targetPort: this.targetPort, target: `127.0.0.1:${this.targetPort}`,
        sessionId: this.sessionId, origin: this.origin, resourceId: effect.resourceId };
      if (fields[key] === undefined) throw new Error(`Unbound recipe field: ${key}`);
      return String(fields[key]);
    });
    if (Array.isArray(value)) return value.map(item => this.expand(item, effect));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.expand(item, effect)]));
    return value;
  }
  admit(effect) {
    if (effect.sessionId !== this.sessionId || !effect.id || !Number.isSafeInteger(effect.generation)) throw new Error('Effect identity mismatch');
    if (this.stopped && effect.operation !== 'remove' && !effect.recipeRef?.startsWith('remove/')) throw new Error('Session stopped; observation or allocation dispatch is fenced');
    if (this.issued.has(effect.id)) throw new Error('Effect already dispatched');
    if (effect.operation !== 'remove' && effect.generation < this.generation) throw new Error('Stale effect generation');
    this.generation = Math.max(this.generation, effect.generation);
    if (effect.action === 'inspect') {
      this.admitInspection(effect); return;
    }
    if (effect.kind === 'timer' && effect.operation === 'health') {
      if (effect.recipeRef !== 'health/expiry' || effect.stepId !== 'expiry' || effect.stage !== 'health' || !this.host.probe ||
          ![...this.proofExpiries.values()].includes(effect.expiresAtMs) || effect.expiresAtMs > this.host.probe.expiresAtMs) throw new Error('Health timer lacks a matching verified receipt');
      return;
    }
    if (this.recoveryOnly && effect.operation !== 'remove') throw new Error('Recovery permits only owned local cleanup');
    if (this.recoveryOnly && effect.kind !== 'persist') {
      const resource = this.journal.value.owned[effect.resourceId];
      if (!resource || !((resource.kind === 'process' && ['spawn', 'owned-process'].includes(effect.kind)) ||
          (resource.kind === 'local-forwarder' && effect.kind === 'local-forwarder'))) throw new Error('Recovery cannot mutate remote or unowned resources');
    }
    if (effect.kind === 'persist') {
      const record = effect.record;
      if (!record || !['create', 'remove'].includes(effect.operation) || record.operation !== effect.operation ||
          record.sessionId !== this.sessionId || record.generation !== effect.generation ||
          record.adapterId !== this.selectedAdapter || (effect.adapterId && effect.adapterId !== record.adapterId) ||
          (effect.resourceId && effect.resourceId !== record.resourceId)) throw new Error('Persist intent scope mismatch');
      if (effect.recipeRef) {
        if (!isDeepStrictEqual(record.bindings, effect.bindings)) throw new Error('Persist binding scope mismatch');
        if (effect.stage !== 'persist' || effect.stepId !== 'intent' || effect.recipeRef !== `${effect.operation}/execute` || !record.execute || record.recipeRef !== effect.recipeRef) throw new Error('Persist plan step mismatch');
        const { parser, ...payload } = record.execute;
        admitPlanEffect({ ...payload, id: effect.id, sessionId: effect.sessionId, generation: effect.generation,
          operation: effect.operation, adapterId: effect.adapterId, resourceId: effect.resourceId,
          recipeRef: record.recipeRef, stage: 'execute', stepId: 'execute', bindings: effect.bindings, bindingRefs: effect.bindingRefs }, this.planContext());
      }
      if (!this.consent && effect.operation === 'create') throw new Error('Persist intent requires consent');
      if (effect.operation === 'remove') {
        const resource = this.journal.value.owned[record.resourceId];
        if (!resource || resource.sessionId !== this.sessionId || resource.adapterId !== record.adapterId) throw new Error('Persist removal requires exact ownership');
      }
      return;
    }
    const operational = effect.recipeRef && !['probe'].includes(effect.operation);
    if (operational) admitPlanEffect(effect, this.planContext());
    if (!operational && (!allowedFields[effect.kind] || Object.keys(effect).some(key => !runtimeFields.has(key) && key !== 'kind' && !allowedFields[effect.kind].includes(key)))) throw new Error('Unsupported recipe execution field; feature admission required');
    if (mutates(effect) && (!this.consent || !this.receipts.has(this.receiptKey(effect)))) throw new Error('Mutation requires consent and durable intent');
    if (effect.operation === 'create' && this.stopped) throw new Error('Session is stopping');
    if (effect.operation === 'create' && effect.kind === 'spawn' && !effect.longRunning && !effect.persistent) throw new Error('Finite create commands require owned mapping readback guards; only persistent owned processes are admitted');
    if (mutates(effect) && effect.recipeRef && this.receipts.get(this.receiptKey(effect)) !== this.payloadKey(effect)) throw new Error('Execution differs from acknowledged durable intent');
    const candidates = this.adapters.filter(adapter => (!effect.adapterId || adapter.id === effect.adapterId) &&
      (!mutates(effect) || adapter.id === this.selectedAdapter));
    const admitted = operational || candidates.some(adapter => {
      if (mutates(effect) && (adapter.ownership === 'external-owned' || adapter.admission || adapter.bindings)) return false;
      const recipe = adapter.recipes?.[effect.operation];
      if (!recipe || recipe.kind !== effect.kind) return false;
      const expanded = this.expand(recipe, effect);
      // Compare all execution fields in both directions; parser interpretation stays in Rust.
      const keys = new Set([...Object.keys(expanded), ...Object.keys(effect)]);
      return [...keys].every(key => runtimeFields.has(key) || key === 'parser' ||
        JSON.stringify(expanded[key]) === JSON.stringify(this.expand(effect[key], effect)));
    });
    // Probe exact core candidate, never a URL supplied in command text.
    const genericProbe = !admitted && effect.kind === 'http-probe' && effect.operation === 'probe' && this.origin &&
      [this.origin, `${this.origin}/`].includes(effect.url ?? effect.origin) && !effect.headers && !effect.body && !effect.method;
    if (!admitted && !genericProbe) throw new Error('Effect is outside admitted recipe scope');
    if (effect.operation === 'remove') {
      const resource = this.journal.value.owned[effect.resourceId];
      if (!resource || resource.sessionId !== this.sessionId || resource.adapterId !== effect.adapterId) {
        throw new Error('Removal requires an exact owned resource in the selected adapter scope');
      }
    }
  }
  async execute(effect) {
    let dispatched = false;
    try {
      this.admit(effect);
      this.issued.add(effect.id);
      effect = this.expand(effect, effect);
      if (mutates(effect) && effect.kind !== 'persist') this.receipts.delete(this.receiptKey(effect));
      let result;
      dispatched = effect.kind !== 'persist';
      if (effect.action === 'inspect') result = await this.inspectOwnership(effect);
      else switch (effect.kind) {
        case 'persist': await this.journal.intent(effect); this.intentRecords.set(this.receiptKey(effect.record), effect.record); this.receipts.set(this.receiptKey(effect.record), effect.record.execute ? this.payloadKey(effect.record.execute, effect.record.bindings) : null); result = { durable: true }; break;
        case 'spawn': result = await this.runProcess(effect); break;
        case 'owned-process':
          if (effect.operation !== 'remove') throw new Error('Owned-process accepts only scoped removal');
          result = await this.removeProcess(effect.resourceId, effect); break;
        case 'read-file': result = await this.readHandle(effect); break;
        case 'http-probe': result = await this.probe(effect); break;
        case 'interfaces': result = { interfaces: networkInterfaces() }; break;
        case 'timer': result = await this.timer(effect); break;
        case 'local-forwarder': result = await this.forward(effect); break;
        default: throw new Error('Unsupported effect kind');
      }
      if (effect.recipeRef && effect.operation === 'observe') {
        const observedAtMs = this.nowMs(); result.observation = { authorityRef: randomUUID(), sessionId: this.sessionId, observedAtMs, expiresAtMs: observedAtMs + 5000 };
      }
      if (effect.recipeRef && effect.operation === 'observe' && effect.resourceId) {
        const receipt = await this.continuity(effect.resourceId);
        if (receipt) result.ownershipReceipt = receipt;
      }
      return { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: true, result };
    } catch (error) {
      return { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation,
        ok: false, result: { ...(!dispatched ? { notApplied: true } : {}), code: error.code ?? 'blocked', detail: error.message } };
    }
  }
  admitInspection(effect) {
    const resource = this.journal.value.owned[effect.resourceId];
    const adapter = this.adapters.find(adapter => adapter.id === effect.adapterId);
    const ledger = effect.ownership;
    const expectedKind = resource?.kind === 'process' ? 'owned-process' : resource?.kind === 'local-forwarder' ? 'local-forwarder' : null;
    if (effect.operation !== 'observe' || effect.recipeRef !== 'remove/ownership' || effect.stepId !== 'ownership' || effect.stage !== 'before' ||
        !resource || resource.sessionId !== this.sessionId || resource.adapterId !== effect.adapterId || effect.kind !== expectedKind ||
        adapter?.planVersion !== 1 || adapter.recipes?.remove?.kind !== expectedKind || adapter.admission?.state !== 'admitted' ||
        adapter.admission.requiredFeatures.some(feature => !this.host.features.includes(feature)) || !ledger ||
        ledger.handleRef !== resource.id || ledger.continuityRef !== resource.continuityRef ||
        !isDeepStrictEqual(ledger.details, resource.details) || !isDeepStrictEqual(ledger.baseline, resource.baseline) ||
        !isDeepStrictEqual(ledger.bindings, resource.bindings)) throw new Error('Intrinsic ownership inspection scope mismatch');
  }
  async inspectOwnership(effect) {
    const ownershipReceipt = await this.continuity(effect.resourceId);
    if (!ownershipReceipt) throw new Error('Local resource continuity unavailable');
    return { details: this.journal.value.owned[effect.resourceId].details, ownershipReceipt };
  }
  timer(effect) {
    const delay = effect.expiresAtMs ? Math.max(1, effect.expiresAtMs - this.nowMs()) : bounded(effect.delayMs, 1, 86400000);
    return new Promise(resolve => {
      const finish = cancelled => { clearTimeout(timer); this.timers.delete(effect.id); resolve(cancelled ? { cancelled: true } : { elapsed: true }); };
      const timer = setTimeout(() => finish(false), Math.min(delay, 86400000));
      this.timers.set(effect.id, () => finish(true));
    });
  }
  cancelTimers() { for (const cancel of [...this.timers.values()]) cancel(); }
  async readHandle(effect) {
    const path = this.handles[effect.handleRef];
    if (!path) throw new Error('Unknown scoped file handle');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw new Error('Handle is not a regular file');
      const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
      const buffer = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit) throw new Error('File exceeds output limit');
      return { stdout: buffer.subarray(0, bytesRead).toString('utf8'), stderr: '', exitCode: 0 };
    } finally { await file.close(); }
  }
  async runProcess(effect) {
    if (effect.operation === 'remove' && this.journal.value.owned[effect.resourceId]?.kind === 'process') {
      return this.removeProcess(effect.resourceId);
    }
    if (typeof effect.program !== 'string' || shellPrograms.has(basename(effect.program)) || !Array.isArray(effect.args)) throw new Error('Invalid direct argv recipe');
    const artifacts = new Set();
    const resolveArgument = async argument => {
      if (effect.recipeRef && (typeof argument === 'number' || typeof argument === 'boolean')) return String(argument);
      if (argument?.kind === 'private-file' && typeof argument.handleRef === 'string' && Object.keys(argument).every(key => ['kind', 'handleRef'].includes(key))) {
        artifacts.add(argument.handleRef); return this.privateFiles.path(argument.handleRef);
      }
      if (typeof argument !== 'string' || argument.includes('\0')) throw new Error('Invalid direct argv recipe');
      let value = argument;
      for (const [name, binding] of Object.entries(effect.bindings ?? {})) {
        if (binding.type !== 'session-private-path') continue;
        if (value === binding.handleRef || value.includes(`{${name}}`)) {
          const path = await this.privateFiles.path(binding.handleRef); artifacts.add(binding.handleRef);
          value = value === binding.handleRef ? path : value.replaceAll(`{${name}}`, path);
        }
      }
      if (/\{[A-Za-z][A-Za-z0-9]*\}/.test(value)) throw new Error('Unresolved argv binding');
      return value;
    };
    const args = await Promise.all(effect.args.map(resolveArgument));
    const timeoutMs = bounded(effect.timeoutMs, 5_000, 120_000);
    const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
    const longRunning = effect.longRunning === true || effect.persistent === true;
    const privateMaterialized = [...artifacts].some(handle => this.journal.value.owned[handle]?.materialized);
    for (const handle of artifacts) {
      const file = this.journal.value.owned[handle];
      if (!file?.materialized) continue;
      const adapter = this.adapters.find(item => item.id === effect.adapterId), spec = adapter?.bindings?.[file.bindingName];
      if (!effect.recipeRef || effect.bindings?.[file.bindingName]?.handleRef !== handle || file.adapterId !== effect.adapterId || file.generation !== effect.generation) throw new Error('Private artifact is outside its exact dispatch scope');
      const declaration = privateMaterializationScope(spec, effect.bindings, this.host.facts ?? {}, { sessionId: this.sessionId, generation: effect.generation, nowMs: this.nowMs(), hostBindings: this.host.bindings });
      if (declaration.declarationHash !== file.declarationHash) throw new Error('Private artifact declaration changed before dispatch');
    }
    if (privateMaterialized && !longRunning) throw new Error('Materialized credentials require an owned long-running process');
    if (privateMaterialized) {
      for (const handle of artifacts) {
        const file = this.journal.value.owned[handle];
        if (file?.materialized) file.pendingDispatch = { effectId: effect.id, sessionId: this.sessionId, generation: effect.generation };
      }
      await this.journal.save();
    }
    const processDetails = longRunning ? this.ledgerDetails(effect) : undefined;
    const child = spawn(effect.program, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, detached: false });
    let resource;
    if (longRunning) {
      try { await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
      catch (error) {
        if (!child.pid && privateMaterialized) {
          for (const handle of artifacts) if (this.journal.value.owned[handle]?.pendingDispatch?.effectId === effect.id) delete this.journal.value.owned[handle].pendingDispatch;
          await this.journal.save();
        }
        throw error;
      }
      const id = randomUUID();
      resource = { id, kind: 'process', pid: child.pid, startIdentity: await processIdentity(child.pid),
        nonce: randomUUID(), artifacts: [...artifacts], ...(privateMaterialized ? { privateMaterialized: true, dispatchEffectId: effect.id } : {}), continuityRef: randomUUID(), bindings: effect.bindings ?? {}, details: processDetails, baseline: this.intentRecords.get(this.receiptKey(effect))?.baseline ?? {}, sessionId: this.sessionId, adapterId: this.selectedAdapter, generation: effect.generation };
      if (!resource.startIdentity) { child.kill('SIGTERM'); throw new Error('Cannot establish process ownership'); }
      if (effect.lifetimeMs) {
        const lifetime = setTimeout(() => { if (!this.stopped) this.onExit({ resourceId: id, reason: 'lifetime-expired' }); }, (this.lifetimeMs ?? bounded(effect.lifetimeMs, 900000, 86400000)));
        lifetime.unref(); child.once('exit', () => clearTimeout(lifetime));
      }
      this.children.set(id, child);
      try {
        await this.journal.own(resource);
        if (privateMaterialized) {
          for (const handle of artifacts) if (this.journal.value.owned[handle]?.pendingDispatch?.effectId === effect.id) delete this.journal.value.owned[handle].pendingDispatch;
          await this.journal.save();
        }
      } catch (error) { child.kill('SIGTERM'); throw error; }
    }
    const completion = await new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), receivedBytes = 0, settled = false, idle;
      const finish = (error, exitCode = null) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); clearTimeout(idle);
        if (error) { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 500).unref(); reject(error); }
        else resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), exitCode,
          ...(resource ? { resourceId: resource.id, ...(effect.recipeRef ? { ownership: this.ownership(resource) } : {}) } : {}) });
      };
      const deadline = setTimeout(() => finish(new Error('Process timed out')), timeoutMs);
      const collect = stream => chunk => {
        this.processOutput(effect,resource,stream,chunk);
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > limit) return finish(new Error('Process output limit exceeded'));
        if (!privateMaterialized) {
          if (stream === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
        }
        // The host only bounds collection. Core parses the collected bytes and decides readiness.
        if (longRunning && !settled) { clearTimeout(idle); idle = setTimeout(() => finish(null), bounded(effect.collectMs, 2000, 10000)); }
      };
      child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
      child.once('error', error => finish(error));
      child.once('close', code => {
        if (settled && resource) this.onExit({ resourceId: resource.id, exitCode: code });
        if (longRunning && !settled) finish(new Error('Owned process exited before its initial output was collected'));
        else finish(null, code);
      });
    });
    if (resource && this.onProcessOutput && !resource.privateMaterialized) {
      this.routeOutputReady.add(resource.id);
    }
    return completion;
  }
  ledgerDetails(effect, actual) {
    const recipe = this.adapters.find(adapter => adapter.id === effect.adapterId)?.recipes?.create;
    if (!recipe?.ledger) return {};
    const expected = expandPlan(recipe.ledger, effect.bindings ?? {});
    if (actual === undefined) return expected;
    if (!isDeepStrictEqual(expected, actual)) throw new Error('Declared ownership ledger differs from actual local resource');
    return actual;
  }
  async proveProcessAbsent(resource) {
    const observedAtMs = this.nowMs();
    if (resource?.sessionId !== this.sessionId || resource.kind !== 'process' || !resource.startIdentity || !resource.continuityRef ||
        await processIdentity(resource.pid) === resource.startIdentity) throw new Error('Recorded process is still running or its birth identity is unavailable');
    const adapter = this.adapters.find(item => item.id === resource.adapterId), remove = adapter?.recipes?.remove;
    if (this.journal.value.state) {
      const ledger = this.journal.value.state.resources?.find(item => item.id === resource.id)?.ledger;
      if (!ledger || ledger.handleRef !== resource.id || ledger.continuityRef !== resource.continuityRef ||
          !isDeepStrictEqual(ledger.bindings, resource.bindings) || !isDeepStrictEqual(ledger.details, resource.details)) throw new Error('Recorded process differs from the durable ownership ledger; inspect the session before retrying stop');
    }
    const processLifetime = adapter?.endpointLifetime === 'owned-process' && adapter.recipes.create?.kind === 'spawn' &&
      adapter.recipes.create.process?.mode === 'owned-long-running' && remove?.kind === 'owned-process' &&
      Array.isArray(remove.before) && !remove.before.length && Array.isArray(remove.after) && !remove.after.length &&
      Array.isArray(remove.requires) && !remove.requires.length;
    if (adapter?.planVersion === 1 && adapter.admission?.state === 'admitted' && processLifetime) {
      if (await processIdentity(resource.pid) === resource.startIdentity || this.nowMs() >= observedAtMs + 5000) throw new Error('Owned endpoint absence changed or expired; retry stop');
      return { sessionId: this.sessionId, handleRef: resource.id, continuityRef: resource.continuityRef,
        processGone: true, providerAbsent: true, observedAtMs, expiresAtMs: observedAtMs + 5000 };
    }
    if (adapter?.planVersion !== 1 || adapter.admission?.state !== 'admitted' || remove?.kind !== 'owned-process' ||
        !remove.before?.length || !remove.after?.length) throw new Error('No admitted identity and absence readbacks are available for this owned process');
    if ((remove.requires ?? []).some(rule => rule.op !== 'owned-ledger-match' || rule.source !== 'ownership' || rule.pointer !== '/route' ||
        Object.keys(rule).some(key => !['op', 'source', 'pointer'].includes(key)))) throw new Error('Unsupported removal prerequisite; absence cannot be proved');
    const step = await loadCore();
    const predicate = (rule, doc) => {
      const parser = { kind: 'json-document', predicate: rule };
      const initial = step({ command: { type: 'detect', sessionId: 'absence-readback' }, adapters: [{ id: 'readback', audience: 'local', ownership: 'external-owned',
        recipes: { detect: { kind: 'spawn', program: 'readback', args: [], parser } } }], requirements: { clientReach: 'this-device' } });
      const effect = initial.effects[0];
      if (!effect) throw new Error('Core did not admit the readback predicate');
      const parsed = step({ state: initial.state, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId,
        generation: effect.generation, ok: true, result: { stdout: JSON.stringify(doc), exitCode: 0 } } });
      return parsed.snapshot.observations.readback === 'present';
    };
    for (const [stage, observations] of [['identity', remove.before], ['absence', remove.after]]) {
      for (const observation of observations) {
        const recipe = observation.recipe;
        if (recipe?.kind !== 'spawn' || !observation.assert || recipe.parser?.kind !== 'json-document' ||
            Object.keys(recipe).some(key => !['kind', 'program', 'args', 'timeoutMs', 'maxOutputBytes', 'parser'].includes(key)) ||
            Object.keys(observation).some(key => !['id', 'recipe', 'assert', 'captures'].includes(key))) throw new Error(`Unsupported ${stage} readback; inspect the admitted removal plan`);
        const expanded = expandPlan(recipe, resource.bindings ?? {});
        const result = await this.runProcess(expanded);
        if (result.exitCode !== 0) throw new Error(`${stage} readback failed; confirm the provider is available and retry stop`);
        const doc = JSON.parse(result.stdout);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !predicate(expanded.parser.predicate, doc) ||
            !predicate(expandPlan(observation.assert, resource.bindings ?? {}), doc)) throw new Error(stage === 'absence' ? `Recorded process is gone; listener ${resource.bindings?.port?.value ?? '(recorded port)'} may still be configured. Inspect the current mapping or stop its owning session, then retry stop.` : 'Identity readback did not match the recorded resource; inspect the current provider identity before retrying stop');
      }
    }
    if (await processIdentity(resource.pid) === resource.startIdentity) throw new Error('Recorded process is still running; absence cannot be proved');
    if (this.nowMs() >= observedAtMs + 5000) throw new Error('Absence readbacks expired; retry stop for a fresh check');
    return { sessionId: this.sessionId, handleRef: resource.id, continuityRef: resource.continuityRef,
      processGone: true, providerAbsent: true, observedAtMs, expiresAtMs: observedAtMs + 5000 };
  }
  async continuity(id) {
    const resource = this.journal.value.owned[id];
    if (!resource || resource.sessionId !== this.sessionId || !resource.continuityRef) return null;
    if (resource.retired && resource.kind === 'process') return null;
    if (resource.retired && resource.kind === 'local-forwarder') {
      const stillGone = !this.forwarders.has(id);
      if (!stillGone) return null;
      const nowMs = this.nowMs(); return { handleRef: id, continuityRef: resource.continuityRef, sessionId: this.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 5000, continuous: true };
    }
    const owned = resource.kind === 'process' ? await attributable(resource, this.sessionId) :
      resource.kind === 'local-forwarder' && this.forwarders.has(id) && resource.daemonPid === process.pid && resource.daemonStartIdentity === await processIdentity(process.pid);
    if (!owned) return null;
    const nowMs = this.nowMs();
    return { handleRef: id, continuityRef: resource.continuityRef, sessionId: this.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 5000, continuous: true };
  }
  ownership(resource) {
    return { handleRef: resource.id, continuityRef: resource.continuityRef, kind: resource.kind === 'local-forwarder' ? 'forwarder' : resource.kind,
      sessionId: resource.sessionId, generation: resource.generation, details: resource.details ?? {} };
  }
  async removeProcess(id, effect = {}) {
    const resource = this.journal.value.owned[id];
    if (!resource || resource.sessionId !== this.sessionId || !resource.nonce || !resource.startIdentity) throw new Error('Unknown owned process');
    for (const key of this.routeLineBuffers.keys()) if (key.startsWith(`${id}\0`)) this.routeLineBuffers.delete(key);
    this.routeOutputReady.delete(id);
    if ((effect.signal && effect.signal !== 'SIGTERM') || (effect.thenSignal && effect.thenSignal !== 'SIGKILL')) throw new Error('Unsupported owned-process signal');
    const attempts = Math.ceil(bounded(effect.graceMs, 500, 5000) / 25);
    if (await attributable(resource, this.sessionId)) {
      process.kill(resource.pid, 'SIGTERM');
      for (let attempt = 0; attempt < attempts && await attributable(resource, this.sessionId); attempt++) await sleep(25);
      if (await attributable(resource, this.sessionId)) process.kill(resource.pid, 'SIGKILL');
      for (let attempt = 0; attempt < 20 && await attributable(resource, this.sessionId); attempt++) await sleep(25);
      if (await attributable(resource, this.sessionId)) throw new Error('Owned process removal unconfirmed');
    }
    for (const handle of resource.artifacts ?? []) {
      if (this.journal.value.owned[handle]) await this.privateFiles.remove(handle);
    }
    if (effect.recipeRef || effect.retainRecord) { resource.retired = true; await this.journal.save(); }
    else await this.journal.removed(id);
    this.children.delete(id);
    return { exitCode: 0, removed: true, resourceId: id };
  }
  async probe(effect) {
    if (this.host.probe) return this.verifyProbe(effect);
    if (effect.vantage && effect.vantage !== 'local') throw Object.assign(new Error('Remote validation required: this executor only observes the local network vantage.'), { code: 'needs-validation' });
    const value = effect.url ?? effect.origin;
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid probe URL');
    const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
    return new Promise((resolve, reject) => {
      let bytes = 0, body = '', settled = false, firstEvent = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(deadline); this.activeRequests.delete(request); request.destroy(); error ? reject(error) : resolve(result); };
      const request = (url.protocol === 'https:' ? https : http).get(url, { headers: effect.sse ? { accept: 'text/event-stream' } : {}, rejectUnauthorized: true }, response => {
        const status = response.statusCode;
        if (status >= 300 && status < 400) return finish(new Error('Probe redirects are not admitted'));
        if (effect.sse && !response.headers['content-type']?.startsWith('text/event-stream')) return finish(new Error('SSE content type missing'));
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > limit) return finish(new Error('Probe output limit exceeded'));
          body += chunk.toString('utf8');
          if (effect.sse && /(?:^|\n)data:[^\n]*\r?\n\r?\n/.test(body)) {
            firstEvent = true;
            finish(null, { status, stdout: '', stderr: '', sseEventReceived: true, timedStreamingVerified: false, vantage: 'local' });
          }
        });
        response.on('end', () => {
          if (effect.sse && !firstEvent) finish(new Error('SSE ended before a complete event'));
          else finish(null, { status, stdout: body, stderr: '', exitCode: status >= 200 && status < 300 ? 0 : 1, vantage: 'local' });
        });
        response.on('error', error => finish(error));
      });
      this.activeRequests.add(request);
      const deadline = setTimeout(() => finish(new Error('Probe timed out')), bounded(effect.timeoutMs, 5_000, 120_000));
      request.on('error', error => finish(error));
    });
  }
  async verifyProbe(effect) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('Probe timed out')), bounded(effect.vantage && effect.vantage !== 'local' ? this.probeWaitMs ?? effect.timeoutMs : effect.timeoutMs, 5000, 600000));
    this.probeControllers.add(controller);
    try { return await this.verifyProbeBounded(effect, controller.signal); }
    finally { clearTimeout(deadline); this.probeControllers.delete(controller); }
  }
  cancelProbes() {
    for (const controller of this.probeControllers) controller.abort(new Error('Probe cancelled'));
    for (const request of this.activeRequests) request.destroy(new Error('Probe cancelled'));
  }
  async verifyProbeBounded(effect, signal) {
    const authorization = effect.probe ?? this.host.probe;
    const nowMs = this.nowMs();
    const origin = safeOrigin(effect.url ?? effect.origin);
    if (effect.tls === true && !origin.startsWith('https:')) throw new Error('HTTPS probe requirement cannot use an HTTP origin');
    if (!authorization || authorization.expiresAtMs <= nowMs || !this.gate || authorization.nonceRef !== this.host.probe?.nonceRef || authorization.verifierRef !== this.host.probe?.verifierRef || authorization.expiresAtMs !== this.host.probe?.expiresAtMs ||
        (effect.nonceRef && effect.nonceRef !== authorization.nonceRef) ||
        (effect.verifierRef && effect.verifierRef !== authorization.verifierRef)) throw new Error('Probe authorization missing, stale or mismatched');
    const vantage = effect.vantage ?? 'local';
    if (vantage !== 'local') {
      if (!this.probeExecutor || !this.probeExecutor.vantages?.includes(vantage) || typeof this.probeExecutor.verify !== 'function') {
        throw Object.assign(new Error('Remote validation required: configure a trusted executor on the client network.'), { code: 'needs-validation' });
      }
      let result;
      try { result = await Promise.race([this.probeExecutor.verify({ signal, origin, vantage, authorization: { ...authorization },
        challenge: this.gate.challenge(), networkTimeoutMs: bounded(effect.timeoutMs, 5000, 120000), requirements: { httpsRequired: effect.tls === true || origin.startsWith('https:'), sse: Boolean(effect.sse), streamableHttp: Boolean(effect.streamableHttp), oauthDcr: Boolean(effect.oauthDcr) } }), new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error('Probe cancelled'));
        else signal.addEventListener('abort', () => reject(new Error('Probe cancelled')), { once: true });
      })]); } catch (error) { throw Object.assign(new Error('Trusted outside validation pending or failed'), { code: error.code ?? 'needs-validation' }); }
      let receipt = result?.probeReceipt;
      const receivedAt = this.nowMs();
      const publicRelay = this.publicRelay === true && authorization.allowPublicRelay === true && vantage === 'public' && receipt?.networkPath === 'public-relay' && receipt.remote === false && receipt.publicDns === true && isPublicIp(receipt.resolvedIp) && receipt.tlsServername === new URL(origin).hostname;
      if (!receipt || receipt.nonceRef !== authorization.nonceRef || receipt.verifierRef !== authorization.verifierRef || receipt.origin !== origin ||
          receipt.vantage !== vantage || (!publicRelay && receipt.remote !== true) || receipt.observedAtMs < nowMs || receipt.observedAtMs > receivedAt || receipt.expiresAtMs <= receivedAt ||
          receipt.instanceMatched !== true || (origin.startsWith('https:') && receipt.tls !== true) ||
          (effect.sse && receipt.sse !== true) || (effect.streamableHttp && receipt.streamableHttp !== true) || (effect.oauthDcr && receipt.oauthDcr !== true)) throw new Error('Trusted remote probe returned an invalid or incomplete receipt');
      receipt = Object.fromEntries(['nonceRef', 'verifierRef', 'origin', 'vantage', 'remote', 'observedAtMs', 'expiresAtMs', 'tls', 'instanceMatched', 'sse', 'streamableHttp', 'oauthDcr', 'networkPath', 'publicDns', 'resolvedIp', 'resolver', 'tlsServername', 'relayHeaders'].map(key => [key, receipt[key]]));
      this.acceptedProbeReceipt = receipt; this.proofGeneration = effect.generation; this.proofProvenance = result.provenance;
      this.proofExpiries.set(effect.generation, Math.min(receipt.expiresAtMs, authorization.expiresAtMs));
      return { status: 200, vantage, probeReceipt: receipt, streaming: receipt.sse === true, streamableHttp: receipt.streamableHttp === true, oauthDcr: receipt.oauthDcr === true };
    }
    const checked = await this.gate.verify(origin, { sse: Boolean(effect.sse), signal });
    const observedAtMs = this.nowMs();
    const probeReceipt = { nonceRef: authorization.nonceRef, verifierRef: authorization.verifierRef, origin, vantage: 'local',
      observedAtMs, expiresAtMs: Math.min(observedAtMs + 15000, authorization.expiresAtMs), tls: checked.tls,
      instanceMatched: checked.instanceMatched, sse: checked.sse, streamableHttp: false, oauthDcr: false };
    this.acceptedProbeReceipt = probeReceipt; this.proofGeneration = effect.generation;
    this.proofExpiries.set(effect.generation, probeReceipt.expiresAtMs);
    return { status: 200, vantage: 'local', streaming: checked.streaming, streamableHttp: false, oauthDcr: false, probeReceipt };
  }
  async forward(effect) {
    if (effect.operation === 'remove') {
      const server = this.forwarders.get(effect.resourceId);
      if (!server) {
        const resource = this.journal.value.owned[effect.resourceId];
        if (!resource || resource.kind !== 'local-forwarder' || resource.sessionId !== this.sessionId || !resource.nonce ||
            !resource.daemonStartIdentity || await processIdentity(resource.daemonPid) === resource.daemonStartIdentity) {
          throw new Error('Forwarder ownership unavailable; reconcile required');
        }
        // The exact owning process is gone, so its in-process listening socket is gone too.
        if (effect.recipeRef || effect.retainRecord) { resource.retired = true; await this.journal.save(); }
        else await this.journal.removed(effect.resourceId);
        return { removed: true, resourceId: effect.resourceId };
      }
      const closed = new Promise(resolve => server.once('close', resolve));
      server.close(); server._ownedSockets.forEach(socket => socket.destroy());
      await closed;
      this.forwarders.delete(effect.resourceId);
      if (effect.recipeRef || effect.retainRecord) { this.journal.value.owned[effect.resourceId].retired = true; await this.journal.save(); }
      else await this.journal.removed(effect.resourceId);
      return { removed: true, resourceId: effect.resourceId };
    }
    if (effect.targetPort !== undefined && effect.targetPort !== this.targetPort) throw new Error('Forward target is outside approved port');
    if (effect.targetHost && effect.targetHost !== '127.0.0.1') throw new Error('Forward target must be loopback');
    const host = effect.bindAddress ?? '127.0.0.1';
    const exactInterface = selectedInterfaceAddress(host) && Object.values(networkInterfaces()).flat().some(address => address?.address === host && address.internal === false);
    if (host !== '127.0.0.1' && (!exactInterface || !this.bindAddresses.includes(host) || !this.firewallApproved)) {
      throw new Error('Firewall prerequisite: approve the exact interface before starting the forwarder');
    }
    if (effect.port && effect.port !== 0) throw new Error('Forwarder requires an owned ephemeral port');
    const details = this.ledgerDetails(effect, { bindAddress: host, targetHost: '127.0.0.1', targetPort: this.targetPort, scheme: 'http' });
    const sockets = new Set();
    const server = net.createServer(client => {
      const upstream = net.connect({ host: '127.0.0.1', port: this.targetPort });
      for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }
      client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
      client.pipe(upstream); upstream.pipe(client);
    });
    server._ownedSockets = sockets;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port: 0, exclusive: true }, resolve); });
    const id = randomUUID();
    const result = { resourceId: id, origin: `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`, port: server.address().port };
    this.forwarders.set(id, server);
    try { await this.journal.own({ id, kind: 'local-forwarder', sessionId: this.sessionId, generation: effect.generation,
      adapterId: this.selectedAdapter, continuityRef: randomUUID(), details, baseline: this.intentRecords.get(this.receiptKey(effect))?.baseline ?? {}, bindings: effect.bindings ?? {}, daemonPid: process.pid, daemonStartIdentity: await processIdentity(process.pid), nonce: randomUUID(), origin: result.origin }); }
    catch (error) { server.close(); this.forwarders.delete(id); throw error; }
    if (effect.recipeRef) result.ownership = this.ownership(this.journal.value.owned[id]);
    return result;
  }
  async closeLocal() {
    this.stopped = true;
    const failures = [];
    for (const [id, resource] of Object.entries(this.journal.value.owned)) {
      try {
        if (resource.kind === 'process') await this.removeProcess(id, { retainRecord: this.journal.value.state?.resources?.some(owned => owned.id === id && owned.cleanup !== 'removed') });
        else if (this.forwarders.has(id)) await this.forward({ operation: 'remove', resourceId: id, retainRecord: this.journal.value.state?.resources?.some(owned => owned.id === id && owned.cleanup !== 'removed') });
      } catch (error) { failures.push({ resourceId: id, detail: error.message }); }
    }
    for (const [id, resource] of Object.entries(this.journal.value.owned)) {
      if (resource.kind !== 'private-file' || Object.values(this.journal.value.owned).some(owned => owned.kind === 'process' && owned.artifacts?.includes(id))) continue;
      try { await this.privateFiles.remove(id); }
      catch (error) { failures.push({ resourceId: id, detail: error.message }); }
    }
    return failures;
  }
}
