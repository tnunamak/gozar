import { mkdir, open, lstat, unlink, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Credential values cross only this private materialization boundary, never core JSON or argv.
export class PrivateFiles {
  constructor({ journal, sessionId, resolveCredential = async () => { throw new Error('Credential handle unavailable'); } }) {
    Object.assign(this, { journal, sessionId, resolveCredential });
    this.root = journal.directory ? join(journal.directory, 'private') : null;
    this.handles = new Map();
  }
  async render(value, admittedRefs) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'credential-ref') {
      if (Object.keys(value).some(key => !['kind', 'handleRef'].includes(key)) || !admittedRefs.has(value.handleRef)) throw new Error('Credential reference outside admitted file scope');
      let secret;
      try { secret = await this.resolveCredential(value.handleRef); } catch { throw new Error('Credential handle unavailable'); }
      if (typeof secret !== 'string' || Buffer.byteLength(secret) > 65536) throw new Error('Invalid credential material');
      return secret;
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.render(item, admittedRefs)));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await this.render(item, admittedRefs)]));
      return Object.fromEntries(entries);
    }
    return value;
  }
  async create({ format = 'text', template = '', credentialRefs = [] } = {}) {
    if (!this.root) throw new Error('Private files require an owned persistent session; detection is read-only');
    if (!['text', 'json'].includes(format) || !Array.isArray(credentialRefs) || credentialRefs.some(ref => typeof ref !== 'string')) throw new Error('Invalid private file declaration');
    await mkdir(this.root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const rootStat = await lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700 || rootStat.uid !== process.getuid()) throw new Error('Private directory ownership or mode mismatch');
    const rendered = await this.render(template, new Set(credentialRefs));
    if (format === 'text' && typeof rendered !== 'string') throw new Error('Text private file requires a string');
    const content = format === 'json' ? JSON.stringify(rendered) : rendered;
    if (Buffer.byteLength(content) > 1_048_576) throw new Error('Private file exceeds size limit');
    const id = randomUUID();
    const path = join(this.root, id);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let resource;
    try {
      await file.writeFile(content); await file.sync();
      const stat = await file.stat();
      resource = { id, kind: 'private-file', sessionId: this.sessionId, nonce: randomUUID(), basename: id, device: stat.dev, inode: stat.ino };
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    } finally { await file.close(); }
    try { await this.journal.own(resource); }
    catch (error) { await unlink(path); throw error; }
    this.handles.set(id, path);
    return { fileHandle: id };
  }
  async path(handle) {
    if (!this.root) throw new Error('Private file broker unavailable for read-only detection');
    const resource = this.journal.value.owned[handle];
    if (!resource || resource.kind !== 'private-file' || resource.sessionId !== this.sessionId || resource.basename !== resource.id || !/^[0-9a-f-]{36}$/.test(resource.basename) || !resource.nonce) throw new Error('Private file handle outside session scope');
    const path = join(this.root, resource.basename);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== resource.device || stat.ino !== resource.inode ||
        stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw new Error('Private file identity or mode changed');
    return path;
  }
  async remove(handle) {
    let path;
    try { path = await this.path(handle); }
    catch (error) { if (error.code === 'ENOENT') { await this.journal.removed(handle); this.handles.delete(handle); return; } throw error; }
    await unlink(path);
    await this.journal.removed(handle);
    this.handles.delete(handle);
    await rmdir(this.root).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
  }
}
