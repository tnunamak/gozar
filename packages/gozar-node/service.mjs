import { readdir, unlink, link, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import { atomicWrite } from './journal.mjs';
import { statusRoutes, durableRouteAt } from './durable-route.mjs';
import { gozarError, normalizeError,instructionAction } from './error-normalizer.mjs';
import { noncePattern, trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock,
  canonicalAuthority, transcript, verification } from './service-state.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {releaseRecordedConfigurationUse} from './runtime-configuration-use.mjs';
import {consentReview,consentSnapshot} from './consent-facts.mjs';
import {issueConsentToken,redeemConsentToken,consentBinding,canonicalDigest} from './consent-token.mjs';
const serviceContext=new AsyncLocalStorage();
export const withServiceContext=(context,action)=>serviceContext.run(context,action);

const refuse = (code, message) => Object.assign(new Error(message), { code });
function originValue(value) {
  if (typeof value !== 'string') throw refuse('invalid_input', 'Invalid service origin');
  let url;
  try { url = new URL(value); } catch { throw refuse('invalid_input', 'Invalid service origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname || (value !== url.origin && value !== url.origin + '/'))
    throw refuse('invalid_input', 'Invalid service origin');
  return url.origin;
}
function targetValue(value) {
  if (typeof value !== 'string') throw refuse('invalid_input', 'Invalid service target');
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+):([0-9]+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 ||
      !Number.isInteger(Number(match[2]))) throw refuse('invalid_input', 'Invalid service target');
  const host = match[1];
  if (host.startsWith('[') && isIP(host.slice(1, -1)) !== 6) throw refuse('invalid_input', 'Invalid service target');
  if (!host.startsWith('[') && !isIP(host) && (host.length > 253 ||
      /^[0-9.]+$/.test(host) || !host.replace(/\.$/, '').split('.').every(label =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) throw refuse('invalid_input', 'Invalid service target');
  return value;
}
// A service route belongs to its owner. The adapter that stands for an owner-kept route is the registered adapter
// whose definition says `ownership: 'external-owned'`; its id is read from the registry, never written in core.
let ownerAdapterId;
function externalOwnerId() {
  if (ownerAdapterId) return ownerAdapterId;
  const adapters = new URL('../../adapters/', import.meta.url);
  for (const entry of JSON.parse(readFileSync(new URL('manifest.json', adapters), 'utf8')).providers) {
    const { adapter } = JSON.parse(readFileSync(new URL(entry.definition, adapters), 'utf8'));
    if (adapter.ownership === 'external-owned') return (ownerAdapterId = adapter.id);
  }
  throw refuse('internal_error', 'The registry has no adapter for an owner-kept route');
}
function config({ origin, target, verifyCmd = null,embedding,generation }) {
  if(generation!==undefined&&generation!==0&&generation!==1)throw refuse('invalid_input','Invalid external tracking generation');
  if (verifyCmd !== null && (typeof verifyCmd !== 'string' || !verifyCmd.trim() || verifyCmd.includes('\0')))
    throw refuse('invalid_input', 'Invalid verification command');
  const route = { schemaVersion: 1, origin: originValue(origin), target: targetValue(target),
    adapterId: externalOwnerId(), ownership: 'external-owned', verifyCmd,...(embedding?{embedding}: {}),...(generation!==undefined?{generation}: {}) };
  if (Buffer.byteLength(JSON.stringify(route)) > 65536) throw refuse('invalid_input', 'Service record exceeds size limit');
  return route;
}
const hash = origin => createHash('sha256').update(origin).digest('hex');
const directory = home => join(home, 'services');
const filename = origin => hash(origin) + '.json';
async function stored(path, name) {
  const value = await readRecord(path);
  const checked = config(value);
  if (value.schemaVersion !== 1 || value.adapterId !== checked.adapterId ||
      value.ownership !== checked.ownership || value.origin !== checked.origin ||
      name !== filename(checked.origin) || Object.keys(value).sort().join() !== Object.keys(checked).sort().join())
    throw new Error('Invalid service record');
  return checked;
}
async function mutate(home, origin, action) {
  const dir = directory(await canonicalHome(home, true));
  await trustedDirectory(dir, true);
  await privateDirectory(dir);
  // Keep the lock inode: unlinking it could split concurrent mutations.
  const locks = join(dir, '.locks');
  await trustedDirectory(locks, true);
  await privateDirectory(locks);
  return withExclusiveLock(join(locks, hash(origin)), () => action(dir));
}
async function currentExternal(route){
 const runtime=serviceContext.getStore();if(!runtime?.embeddingServices||!route.embedding)return null;
 const adapter=runtime.adapters.find(item=>item.id===route.adapterId);if(!adapter)throw refuse('provider_unavailable','The recorded owner-route adapter is unavailable');
 return currentRouteReview(route.embedding.request,adapter,runtime);
}
async function present(route) {
 // Records without a generation predate the current handle contract: history only.
 if((route.generation??0)===0)return {...route,verification:{status:'unverified',checkedAt:null,observedAt:null,subject:null}};
 const runtime=serviceContext.getStore(),current=await currentExternal(route);
 let checked;
 if(current&&current.review.consentFactsDigest!==route.embedding.consentReview.consentFactsDigest){
  route.embedding.reviewRequired=true;
  await mutate(route.embedding.request.home,route.origin,async dir=>{const fresh=await stored(join(dir,filename(route.origin)),filename(route.origin));if(fresh.embedding?.consentReview.consentFactsDigest===route.embedding.consentReview.consentFactsDigest)await atomicWrite(join(dir,filename(route.origin)),{...fresh,embedding:{...fresh.embedding,reviewRequired:true}});});
 }
 if(current&&route.embedding.reviewRequired)checked={status:'unverified',checkedAt:null,observedAt:null,subject:null};
 else checked=await (runtime?.verify??verification)(route);
 if(current){const identity=await runtime.embeddingServices.resolveIdentity({home:route.embedding.request.home});checked={...checked,observedAt:checked.checkedAt??null,subject:{origin:route.origin,target:route.target,...identity,handleGeneration:route.generation},validUntil:checked.checkedAt?new Date(Date.parse(checked.checkedAt)+15000).toISOString():null};}
 return {...route,verification:checked,...(current&&checked.status!=='verified'?{consentChange:{oldDigest:route.embedding.consentReview.consentFactsDigest,newDigest:current.review.consentFactsDigest,reason:'consent-or-proof-changed',nextAction:instructionAction('review-route-consent','Review changed route consent','Call reviewRouteConsent for this handle and show its current snapshot before approval.')}}:{})};
}
async function addServiceUnguarded({ origin, target, verifyCmd = null, home = defaultHome(),embedding }) {
  const route = config({ origin, target, verifyCmd,embedding,generation:1 });
  await mutate(home, route.origin, async dir => {
    const name = filename(route.origin), path = join(dir, name);
    try {
      const existing = await stored(path, name);
      if (JSON.stringify(existing) !== JSON.stringify(route)) throw refuse('route_conflict', 'Service ownership conflict');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const staging = join(dir, hash(route.origin) + '.' + randomUUID() + '.pending');
    try {
      await atomicWrite(staging, route);
      // Atomic exclusive publication: never replace an existing origin record.
      await link(staging, path);
      const fd = await open(dir, 'r');
      try { await fd.sync(); } finally { await fd.close(); }
    } finally { await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
  return { schemaVersion: 1, route: await present(route) };
}
async function statusServicesUnguarded({ origin, home = defaultHome() } = {}) {
  const normalized = origin === undefined ? null : originValue(origin);
  // Resolve the home once; a missing home has no routes of either kind.
  try { home = await canonicalHome(home); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, routes: [] }; throw error; }
  let names = [];
  try {
    await trustedDirectory(directory(home));
    await privateDirectory(directory(home));
    names = await readdir(directory(home));
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const routes = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || (normalized && name !== filename(normalized))) continue;
    routes.push(await stored(join(directory(home), name), name));
  }
  // One place to ask which long-lived routes exist: owner-managed and Gozar-owned durable routes.
  const durable = (await statusRoutes({ home, canonical: true })).routes.filter(route => !normalized || route.origin === normalized);
  return { schemaVersion: 1, routes: [...await Promise.all(routes.map(present)), ...durable] };
}
async function removeServiceUnguarded({ origin, home = defaultHome(),expectedGeneration }) {
  origin = originValue(origin);
  const removed = await mutate(home, origin, async dir => {
    // A Gozar-owned record must never be deleted while its provider route stays live.
    const owned = await durableRouteAt(dirname(dir), origin);
    if (owned) throw Object.assign(new Error(`Route ${owned} is gozar-owned; remove it with releaseRoute({ routeId: '${owned}' }) or \`gozar stop --route ${owned}\``), { code: 'gozar_owned' });
    const name = filename(origin), path = join(dir, name);
    let record;try { record=await stored(path, name); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if(expectedGeneration!==undefined&&expectedGeneration!==(record.generation??0))throw refuse('route_conflict','The external tracking generation does not match');
    await unlink(path);
    const runtime=serviceContext.getStore();if(record.embedding&&runtime?.embeddingServices)await releaseRecordedConfigurationUse({registryId:record.embedding.consentReview?.canonicalInput.scope.registryId,home,owner:record.embedding.request.owner,providerId:record.adapterId,handle:{kind:'external',id:origin,generation:record.generation??0}},runtime);
    const fd = await open(dir, 'r');
    try { await fd.sync(); } finally { await fd.close(); }
    return true;
  });
  return { schemaVersion: 1, origin, removed };
}
async function externalReview(route,handle){
 if(route.generation!==1||handle.generation!==route.generation)throw refuse('route_conflict','Legacy or mismatched external tracking cannot receive current consent');
 const current=await currentExternal(route);if(!current)throw refuse('unsupported','This owner route has no current consent authority');
 const runtime=serviceContext.getStore(),identity=await runtime.embeddingServices.resolveIdentity({home:route.embedding.request.home});
 const subject={origin:route.origin,target:route.target,...identity,handleGeneration:handle.generation};
 const review=consentReview({scope:{...current.review.canonicalInput.scope,reviewHandle:handle.id,handleGeneration:handle.generation},typedDisclosures:current.review.canonicalInput.typedDisclosures,facts:current.facts});
 const binding={...consentBinding(route.embedding.request,route.embedding.request.home,`runtime-review:${review.consentFactsDigest}`,review.consentFactsDigest),handle,subject};
 return {current,review,subject,binding};
}
export async function reviewExternalConsent({home,handle}){
 return mutate(home,handle.id,async dir=>{
  const path=join(dir,filename(handle.id)),route=await stored(path,filename(handle.id));
  const {review,subject,binding}=await externalReview(route,handle);
  route.embedding.reviewRequired=true;await atomicWrite(path,route);
  const issued=await issueConsentToken({home,binding,grant:{adapterId:route.adapterId,planDigest:canonicalDigest(binding),observedResource:route.origin}});
  return {...consentSnapshot(review),subject,approvalToken:issued.token,expiresAt:issued.expiresAt};
 });
}
export async function approveExternalConsent({home,handle,approvalToken,consentFactsDigest}){
 return mutate(home,handle.id,async dir=>{
  const path=join(dir,filename(handle.id)),route=await stored(path,filename(handle.id));
  const {current,review,subject,binding}=await externalReview(route,handle);
  if(review.consentFactsDigest!==consentFactsDigest)throw refuse('consent_mismatch','The owner-route review changed');
  await redeemConsentToken({home,token:approvalToken,binding,providerId:route.adapterId});
  const runtime=serviceContext.getStore(),checked=await (runtime.verify??verification)(route);
  if(checked.status!=='verified'){route.embedding.reviewRequired=true;await atomicWrite(path,route);throw refuse('verification_failed','The owner route did not pass fresh proof');}
  const previousRegistry=route.embedding.consentReview.canonicalInput.scope.registryId,use={home,owner:route.embedding.request.owner,providerId:route.adapterId,handle};
  await runtime.embeddingServices.registerConfigurationUse({...use,revision:current.configuration.revision});
  route.embedding={...route.embedding,consentReview:current.review,reviewRequired:false};await atomicWrite(path,route);
  if(previousRegistry!==runtime.registryId)await releaseRecordedConfigurationUse({...use,registryId:previousRegistry},runtime);
  return {...route,verification:{...checked,subject,observedAt:checked.checkedAt,validUntil:new Date(Date.parse(checked.checkedAt)+15000).toISOString()}};
 });
}
export function createServiceVerifier() {
  const instanceId = randomUUID();
  const secret = randomBytes(32);
  return (req, res) => {
    if (req.method !== 'GET' || typeof req.url !== 'string') return false;
    const match = /^\/\.well-known\/gozar\/service\?nonce=([0-9a-f]{64})$/.exec(req.url);
    if (!match || !noncePattern.test(match[1])) return false;
    let authority;
    try {
      if (!Array.isArray(req.rawHeaders) || req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1) return false;
      authority = canonicalAuthority(req.headers.host);
    } catch { return false; }
    const localPort = req.socket?.localPort;
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) return false;
    const proof = createHmac('sha256', secret).update(transcript(match[1], instanceId, authority, localPort), 'utf8').digest('hex');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ schemaVersion: 2, nonce: match[1], instanceId, authority, localPort, proof }));
    return true;
  };
}

// The kept hand-back and release exports. They leave through the normaliser, like every public export.
import * as durable from './durable-route.mjs';
import { defaultHome } from './default-home.mjs';
const guarded = action => async (...args) => { try { return await action(...args); } catch (error) { throw normalizeError(error); } };
export const releaseRoute = guarded(durable.releaseRoute);
export const confirmHandBack = guarded(durable.confirmHandBack);
export const cancelHandBack = guarded(durable.cancelHandBack);
// Service state errors that carry no code are Gozar's own messages about the user's own paths and records (a dangling
// alias, a record over the size limit, a lock file with the wrong mode). They keep their message and get the closed
// code `internal_error`; the lock code that raises some of them belongs to another change and is not recoded here.
const guardedService = action => guarded(async (...args) => {
  try { return await action(...args); }
  catch (error) { throw error instanceof Error && error.code === undefined ? gozarError('internal_error', error.message, null, error) : error; }
});
export const addService = guardedService(addServiceUnguarded);
export const statusServices = guardedService(statusServicesUnguarded);
export const removeService = guardedService(removeServiceUnguarded);
