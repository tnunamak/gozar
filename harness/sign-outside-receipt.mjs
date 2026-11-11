#!/usr/bin/env node
// LOCAL ONLY: Run locally after authenticating the actual remote job's provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { receiptMac } from '../packages/gozar-node/probe-directory.mjs';
import { readLocalProbeKey } from './local-probe-key.mjs';
import { validateDrop1aReceipt } from './drop1a-receipt.mjs';
const [privatePathArg, envelopePathArg, runDirectoryArg, executorId] = process.argv.slice(2);
assert.ok(privatePathArg && envelopePathArg && runDirectoryArg && executorId);
const privatePath = resolve(privatePathArg), directory = resolve(runDirectoryArg);
const { raw, key } = await readLocalProbeKey(privatePath, executorId);
assert.equal(basename(privatePath), `${raw.requestId}.request.json`, 'exact private channel request filename required');
const envelope = JSON.parse(await readFile(resolve(envelopePathArg), 'utf8'));
const context = JSON.parse(await readFile(join(directory, 'service-context.json'), 'utf8'));
validateDrop1aReceipt(envelope, raw, { ...context, executorId });
const receipt = envelope.probeReceipt;
const response = { requestId: raw.requestId, receipt, mac: receiptMac(receipt, key) };
const responsePath = join(dirname(privatePath), `${raw.requestId}.receipt.json`);
await writeFile(join(directory, 'trusted-outside-receipt.json'), JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
await writeFile(responsePath, JSON.stringify(response), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ responsePath, requestId: raw.requestId, executorId: envelope.executorId, jobId: envelope.jobId }));
