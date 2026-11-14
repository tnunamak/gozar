import { mkdir, open, rename, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { processIdentity } from './process-identity.mjs';

// Commit one complete record, then sync the directory before acknowledging durability.
export async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close(); file = null;
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export class Journal {
  constructor(directory) { this.directory = directory; this.value = { version: 1, owned: {}, intents: {} }; this.writes = Promise.resolve(); }
  get path() { return join(this.directory, 'session.json'); }
  async load() {
    try { this.value = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.value.version !== 1) throw new Error('Unsupported journal version');
    return this.value;
  }
  async save(patch = {}) {
    this.value = { ...this.value, ...patch };
    const write = this.writes.then(() => atomicWrite(this.path, this.value));
    this.writes = write.catch(() => {});
    await write;
  }
  async intent(effect) {
    // No raw process/network output, environment or credentials enter the journal.
    this.value.intents[effect.id] = { sessionId: effect.sessionId, generation: effect.generation,
      operation: effect.operation, operationId: this.value.operationId ?? null, ...(effect.recipeRef ? { record: effect.record } : {}), adapterId: effect.record?.adapterId ?? effect.adapterId, resourceId: effect.record?.resourceId ?? effect.resourceId, durable: true };
    await this.save();
  }
  async own(resource) { resource.operationId ??= this.value.operationId ?? null; this.value.owned[resource.id] = resource; await this.save(); }
  async removed(id) { delete this.value.owned[id]; await this.save(); }
}

export { processIdentity };

export async function attributable(resource, sessionId) {
  return resource?.sessionId === sessionId && typeof resource.nonce === 'string' &&
    resource.startIdentity && await processIdentity(resource.pid) === resource.startIdentity;
}
