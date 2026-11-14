import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {routeMain} from '../../packages/gozar-node/route-cli.mjs';
import {scratch} from './route-schema-check.mjs';
test('recovery CLI lists before a handle is known and redeems only an explicit private runtime approval',async t=>{
 const home=await scratch(t),handle={kind:'attached',id:'opaque',generation:1},handleFile=join(home,'handle.json'),approvalFile=join(home,'approval.json');
 await writeFile(handleFile,JSON.stringify({home,handle}));await writeFile(approvalFile,JSON.stringify({approvalToken:'private-review-token',consentFactsDigest:'review-digest'}),{mode:0o600});
 const seen=[],api={listRoutes:async request=>{seen.push(request);return {routes:[]};},routeStatus:async request=>{seen.push(request);return {};},closeRoute:async request=>{seen.push(request);return {cleanup:{state:'confirmed'}};},reviewRouteConsent:async request=>{seen.push(request);return {};},approveRouteConsent:async request=>{seen.push(request);return {};}};
 const run=async args=>{let stdout='';const exit=await routeMain([...args,'--json'],{api,stdout:{write:chunk=>stdout+=chunk},stderr:{write(){}}});return {exit,body:JSON.parse(stdout)};};
 assert.equal((await run(['routes','--home',home,'--owner','host'])).exit,0);assert.deepEqual(seen[0],{home,owner:'host'});
 for(const command of ['route-status','review-consent','close'])assert.equal((await run([command,'--handle-file',handleFile])).exit,0);
 assert.equal((await run(['approve-consent','--handle-file',handleFile])).exit,3);assert.equal(seen.length,4);
 assert.equal((await run(['approve-consent','--handle-file',handleFile,'--approval-file',approvalFile])).exit,0);assert.deepEqual(seen.at(-1),{home,handle,approvalToken:'private-review-token',consentFactsDigest:'review-digest'});
});
