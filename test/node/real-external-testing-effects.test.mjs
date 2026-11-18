import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
function forwardChallenge(target, url, headers) {
 return new Promise((resolve,reject)=>{
  const pending=http.get(`http://${target}${url.pathname}${url.search}`,{headers},response=>{
   const chunks=[];
   response.on('data',chunk=>chunks.push(chunk));
   response.once('error',reject);
   response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,
    chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));
  });
  pending.once('error',reject);
 });
}
test('owner-kept HTTP proof binds the host subject and close only withdraws the local record',async t=>{
 let harness,app;t.after(async()=>{await harness?.close();if(app)await new Promise(resolve=>app.close(resolve));});
 const home=await scratch(t);const verifier=createServiceVerifier();app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('owner app');});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 let fetches=0;const target=`127.0.0.1:${app.address().port}`,origin='https://owner.fixture.invalid';
 harness=await createTestingGozar({effects:[{kind:'network',operation:'fetch',handle:async request=>{
  fetches++;return forwardChallenge(target,new URL(request.url),request.headers);
 }}]});const api=harness.gozar;
 const q=query({home,target,origin,providerId:'own-address',operationId:'owner-before-call',usage:{kind:'durable',routeId:'owner-fixture'},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'stable',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const request={...q,approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}};
 const route=await api.ensureRoute(request);assert.equal(route.ownership,'external-owned');assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,target);assert.equal(route.operationId,q.operationId);assert.ok(fetches>=2);
 const review=await api.reviewRouteConsent({home,handle:route.handle});assert.equal(review.subject.target,target);assert.equal(review.scope.kind,'route');assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
 await assert.rejects(api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:'consent-v1:wrong'}),{code:'consent_mismatch'});
 const reviewed=await api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});assert.deepEqual(reviewed.handle,route.handle);assert.equal(reviewed.verification.status,'verified');
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');assert.equal(await (await fetch(`http://${target}`)).text(),'owner app');
 assert.equal((await api.ensureRoute(request)).state,'released');
});

test('existing-origin selection excludes a matching managed offer and rechecks the external plan before dispatch', async t => {
 const home = await scratch(t), root = join(home, 'registry');
 const managed = await fakeRegistry({dir:root,id:'managed-fixture',kinds:['durable'],reach:'internet'});
 const external = await fakeRegistry({dir:root,id:'owner-kept-fixture',kinds:['durable'],reach:'internet'});
 const managedDir = join(root, 'providers', 'managed-fixture');
 const externalDir = join(root, 'providers', 'owner-kept-fixture');
 const ready = "async detect() { return {state:'ready',facts:{}}; },";
 const managedModule = join(managedDir, 'index.mjs');
 const managedDefinition = join(managedDir, 'definition.json');
 const managedData = JSON.parse(await readFile(managedDefinition, 'utf8'));
 delete managedData.adapter.ownership;
 await writeFile(managedDefinition, JSON.stringify(managedData));
 await writeFile(managedModule, (await readFile(managedModule, 'utf8')).replace('  ...plain,', '  ...plain,\n  '+ready));
 const externalDefinition = join(externalDir, 'definition.json');
 const externalData = JSON.parse(await readFile(externalDefinition, 'utf8'));
 externalData.adapter.ownership = 'external-owned';
 await writeFile(externalDefinition, JSON.stringify(externalData));
 const planState = join(externalDir, 'plan-owner');
 await writeFile(planState, 'external-owned');
 await writeFile(join(externalDir, 'index.mjs'), `
  import {readFileSync} from 'node:fs';
  import base from './plain.mjs';
  export default {
    ...base, ${ready}
    async plan(ctx, request) {
      const plan = await base.plan(ctx, request);
      const owner = readFileSync(new URL('./plan-owner', import.meta.url), 'utf8');
      return {...plan, effects:owner === 'external-owned' ? [] : plan.effects, cleanup:{kind:owner}};
    },
  };
 `);
 const verifier = createServiceVerifier();
 const app = http.createServer((req,res)=>{if(!verifier(req,res))res.end('owner app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>app.close(resolve)));
 const target = '127.0.0.1:'+app.address().port, origin = 'https://a.managed-fixture.invalid';
 const harness = await createTestingGozar({
   root, manifest:{providers:[...managed.manifest.providers,...external.manifest.providers]},
   effects:[{kind:'network',operation:'fetch',handle:async ({url,headers})=>{
     const request = new URL(url);
     assert.ok([origin, 'http://'+target].includes(request.origin));
     return forwardChallenge(target,request,headers);
   }}],
 });
 t.after(()=>harness.close());
 const api = harness.gozar, q = query({home,target,origin,usage:{kind:'durable',routeId:'existing'},
   requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'stable',setup:'allow',protocols:[]}});
 const relevant = candidate => candidate.eligible && candidate.candidateToken &&
   candidate.consent.scope.query.expectedOrigin === origin && candidate.consent.scope.query.target === target;
 const ownerOffer = rows => rows.find(row=>relevant(row) && row.ownership === 'external-owned');
 const {candidates} = await api.catalogRoutes(q);
 const both = candidates.filter(relevant);
 assert.equal(both.length, 2, 'both offers name the same origin and target');
 assert.equal(both[0].ownership, 'gozar-owned', 'missing definition ownership defaults to managed');
 const choice = ownerOffer(both);
 assert.equal(choice.providerId, 'owner-kept-fixture');
 assert.equal(choice.consent.disclosures.ownership, 'external-owned');
 const approval = candidate => ({kind:'route',candidateToken:candidate.candidateToken,
   disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest});
 const store = join(managedDir, 'store.json'), untouched = await readFile(store, 'utf8');
 await writeFile(planState, 'gozar-owned');
 await assert.rejects(api.ensureRoute({...q,approval:approval(choice)}),{code:'candidate_stale'});
 assert.equal(ownerOffer((await api.catalogRoutes(q)).candidates), undefined, 'no approved external match means no dispatch');
 assert.equal(harness.events.length, 0);
 assert.equal(await readFile(store, 'utf8'), untouched);
 await writeFile(planState, 'external-owned');
 const current = ownerOffer((await api.catalogRoutes(q)).candidates);
 const view = await api.ensureRoute({...q,approval:approval(current)});
 assert.equal(view.ownership, 'external-owned');
 assert.equal(view.published, origin, JSON.stringify({verification:view.verification,consentChange:view.consentChange,events:harness.events}));
 assert.equal(view.verification.subject.target, target);
 const review = await api.reviewRouteConsent({home,handle:view.handle});
 assert.equal(review.scope.providerId, current.providerId);
 assert.equal(review.disclosures.ownership, 'external-owned');
 assert.equal((await api.closeRoute({home,handle:view.handle,mode:'remove'})).cleanup.state, 'confirmed');
 assert.equal(await (await fetch('http://'+target)).text(),'owner app');
 assert.equal(await readFile(store, 'utf8'), untouched);
 await assert.rejects(readFile(join(externalDir, 'events.jsonl'), 'utf8'), {code:'ENOENT'});
});
