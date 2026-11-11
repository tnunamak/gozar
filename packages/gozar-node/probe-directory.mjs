import { mkdir, lstat, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { atomicWrite } from './journal.mjs';

export function receiptMac(receipt, key) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return createHmac('sha256', Buffer.from(key, 'base64url')).update(JSON.stringify(canonical(receipt))).digest('hex');
}

// Private host channel for the explicitly delegated outside verifier. It never creates a route.
export class ProbeDirectoryExecutor {
  constructor(directory, { vantages = ['public'], executorRef = 'outside-verifier', requestPath, receiptPath } = {}) {
    Object.assign(this, { directory, vantages, executorRef, requestPath, receiptPath });
  }
  async verify({ origin, vantage, authorization, challenge, requirements, networkTimeoutMs, signal }) {
    if (!this.vantages.includes(vantage)) throw new Error('Outside verifier does not cover this network');
    await mkdir(this.directory, { mode: 0o700, recursive: true });
    const directoryStat = await lstat(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== process.getuid() || (directoryStat.mode & 0o777) !== 0o700) throw new Error('Outside verifier directory must be owned mode 0700');
    const requestId = randomUUID(), key = randomBytes(32).toString('base64url');
    const requestPath = this.requestPath ?? join(this.directory, `${requestId}.request.json`);
    const responsePath = this.receiptPath ?? join(this.directory, `${requestId}.receipt.json`);
    const keyPath = `${requestPath}.key.json`;
    await atomicWrite(keyPath, { key, requestId, executorId: this.executorRef });
    await atomicWrite(requestPath, { version: 1, requestId, executorRef: this.executorRef, executorId: this.executorRef, origin, vantage,
      authorization, challenge, requirements, networkTimeoutMs, authentication: { algorithm: 'hmac-sha256', keyPath } });
    try {
      for (;;) {
        if (signal.aborted) throw Object.assign(new Error('Outside verification still pending'), { code: 'needs-validation' });
        try {
          const file = await open(responsePath, constants.O_RDONLY | constants.O_NOFOLLOW);
          let response;
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) throw new Error('Outside receipt file scope or size invalid');
            response = JSON.parse(await file.readFile('utf8'));
          } finally { await file.close(); }
          if (this.receiptPath) {
            if (response.executorId !== this.executorRef || typeof response.jobId !== 'string' || !response.jobId.length || !response.probeReceipt) throw new Error('Trusted outside file executor identity or job receipt mismatch');
            const { mac, ...envelope } = response;
            const expected = receiptMac(envelope, key);
            if (response.requestId !== requestId || !/^[a-f0-9]{64}$/.test(mac ?? '') || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(mac, 'hex'))) throw new Error('Outside receipt authentication failed');
            const receipt = response.probeReceipt;
            if (receipt.nonceRef !== authorization.nonceRef || receipt.verifierRef !== authorization.verifierRef || receipt.origin !== origin) {
              await new Promise(resolve => setTimeout(resolve, 25)); continue;
            }
            return { probeReceipt: receipt, provenance: { executorId: response.executorId, jobId: response.jobId } };
          }
          const expected = receiptMac(response.receipt, key);
          if (response.requestId !== requestId || !/^[a-f0-9]{64}$/.test(response.mac ?? '') ||
              !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(response.mac, 'hex'))) throw new Error('Outside receipt authentication failed');
          return { probeReceipt: response.receipt };
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } finally {
      for (const path of this.requestPath ? [] : [requestPath, responsePath, keyPath]) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
