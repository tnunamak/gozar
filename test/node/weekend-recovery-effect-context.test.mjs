// Context-delivery units only: no provider allocation, removal or publication claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,lstat,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {projectAttached,unknownProperties} from '../../packages/gozar-node/route-view.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

async function homeFor(t){
 const parent=join(homedir(),'.tmp0700');
 try{await mkdir(parent,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const p=await lstat(parent);assert.ok(p.isDirectory()&&!p.isSymbolicLink());
 assert.equal(p.uid,process.getuid());assert.equal(p.mode&0o777,0o700);
 const home=await mkdtemp(join(parent,'ctx-')),original=await lstat(home);
 t.after(async()=>{const current=await lstat(home);assert.equal(current.ino,original.ino);
  assert.equal(current.dev,original.dev);assert.equal(current.uid,original.uid);
  assert.ok(current.isDirectory()&&!current.isSymbolicLink());await rm(home,{recursive:true});});
 return home;
}
const uncertain=request=>projectAttached({state:'uncertain',properties:unknownProperties(),target:'127.0.0.1:41237',
 cleanup:{state:'unconfirmed',message:'unit retains resource debt'}},{handle:request.handle});

for(const kind of ['attached','session'])test(kind+' public close forwards selected recovery context',async t=>{
 const home=await homeFor(t),adapter={id:'context-fixture',definition:{id:'context-fixture'}};
 const adapters=[adapter],embeddingServices={},readContext={home,platform:process.platform};
 const dispatchEffect=async()=>assert.fail('delivery unit must not dispatch effects');
 let captured;
 const attached={genericSessionRecord:async request=>request.handle.kind==='session',
  closeAttachedRoute:async(request,deps)=>{captured=deps;return uncertain(request);}};
 const options={adapters,embeddingServices,readContext,dispatchEffect,view:{attached}};
 const api=createRouteApi(options);
 const handle={kind,id:kind==='attached'?'att_0123456789abcdef':'port-41237:context_fixture',generation:7};
 const result=await api.closeRoute({home,owner:'context-owner',handle,mode:'remove'});
 assert.equal(result.published,null);assert.equal(result.cleanup.state,'unconfirmed');
 assert.equal(captured.registryId,await registryIdentity(options));
 assert.equal(captured.home,home);assert.equal(captured.owner,'context-owner');
 assert.equal(captured.embeddingServices,embeddingServices);assert.equal(captured.readContext,readContext);
 assert.equal(captured.dispatchEffect,dispatchEffect);assert.equal(captured.adapters,adapters);
 const effects=captured.effectContext({adapter,readContext,generation:7});
 assert.equal(effects.generation,7);assert.equal(effects.dispatchEffect,dispatchEffect);
 await effects.assertGeneration();
 await assert.rejects(effects.executePlan({}),{code:'unsupported'});
 await assert.rejects(effects.compareAndRemove({},{}),{code:'unsupported'});
 assert.throws(()=>captured.effectContext({adapter,readContext,generation:8}),{code:'route_conflict'});
 assert.throws(()=>captured.effectContext({adapter:{...adapter},readContext,generation:7}),{code:'route_conflict'});
});

test('explicit factory overrides and explicit no-authority remain intact',async t=>{
 const home=await homeFor(t),custom=()=>({generation:99}),readContext={custom:true};
 for(const effectContext of [custom,null]){
  let captured;
  const api=createRouteApi({adapters:[],embeddingServices:{},view:{
   attachedDeps:{effectContext,readContext},
   attached:{closeAttachedRoute:async(request,deps)=>{captured=deps;return uncertain(request);}},
  }});
  await api.closeRoute({home,owner:'owner',mode:'remove',
   handle:{kind:'attached',id:'att_0123456789abcdef',generation:1}});
  assert.equal(captured.effectContext,effectContext);assert.equal(captured.readContext,readContext);
 }
});

test('missing owner does not acquire a default effect factory from request fields',async t=>{
 const home=await homeFor(t);let captured;
 const api=createRouteApi({adapters:[],embeddingServices:{},view:{
  attached:{closeAttachedRoute:async(request,deps)=>{captured=deps;return uncertain(request);}},
 }});
 const result=await api.closeRoute({home,mode:'remove',effectContext:()=>assert.fail('untrusted request factory'),
  handle:{kind:'attached',id:'att_0123456789abcdef',generation:1}});
 assert.equal(captured.effectContext,undefined);assert.equal(result.cleanup.state,'unconfirmed');
});
