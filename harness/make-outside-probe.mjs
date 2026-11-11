#!/usr/bin/env node
// Bundle the read-only observer for an existing trusted worker; this does not submit a job.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { sanitizeOutsideRequest } from './outside-request.mjs';
const directory = resolve(process.argv[2] ?? '.');
const rawPath = resolve(process.argv[3] ?? join(directory, 'probe-request.json'));
const raw = JSON.parse(await readFile(rawPath, 'utf8'));
const context = JSON.parse(await readFile(join(directory, 'service-context.json'), 'utf8'));
const request = sanitizeOutsideRequest(raw, context);
const sanitizedPath = join(directory, 'probe-request.json');
assert.ok(!(rawPath === sanitizedPath && raw.receiptKey), 'keep the private MAC request separate; pass its exact path as the second argument');
if (rawPath !== sanitizedPath) await writeFile(sanitizedPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
assert.ok(request.authorization?.nonceRef && request.authorization.verifierRef && request.challenge?.nonce && request.serviceNonce && request.toolEcho);
const base = new URL('./', import.meta.url);
const source = async name => {
  let text = await readFile(new URL(name, base), 'utf8');
  text = text.slice(0, text.indexOf("if (process.argv[1]"));
  return text.split('\n').filter(line => !line.startsWith('import ')).join('\n').replaceAll('export ', '');
};
const script = [
  "import assert from 'node:assert/strict';",
  "import { randomUUID } from 'node:crypto';",
  await source('probe.mjs'), await source('live-probe.mjs'),
  `console.log(JSON.stringify(await observeLive(${JSON.stringify(request)})));`,
].join('\n');
const path = join(directory, 'outside-probe.mjs'); await writeFile(path, script, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ path, request: { origin: request.origin, nonceRef: request.authorization.nonceRef, verifierRef: request.authorization.verifierRef, expiresAtMs: request.authorization.expiresAtMs }, instruction: 'Execute this Node script once on the existing trusted remote worker. Return raw stdout, exit status, actual job identity and network/TLS limits. No local substitute, provider mutation, account, service or deployment.' }));
