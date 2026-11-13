import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {startEmbeddingBroker,connectEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';
test('real child resolver uses host keychain, locked and lost broker fail closed',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-broker-'));let locked=false;const canary='KEYCHAIN_CANARY_742';const identity={instanceId:'host',bootId:'boot'};
 const services=createEmbeddingServices({registryId:'fixture',identity,secretBackend:{put:async()=>({handle:'opaque'}),withSecret:async(_,use)=>{if(locked)throw {code:'secret_backend_locked'};return use(Buffer.from(canary));},presence:async()=>locked?{known:false,reason:'secret_backend_locked'}:{known:true,value:true},delete:async()=>({deleted:true})}});
 let broker,client;try{
 const c=await services.readConfiguration({home,providerId:'new-provider'});const r={home,providerId:'new-provider',scopeId:c.scopeId,inputId:'key',expectedConfigurationRevision:c.revision};await services.storeSecret({...r,bytes:Buffer.from(canary)});await services.mutateConfiguration(r,tx=>tx.bindSecret('key','opaque'));
 broker=await startEmbeddingBroker({services,home,identity});
 const source=`import {connectEmbeddingBroker} from ${JSON.stringify(new URL('../../packages/gozar-node/embedding-broker.mjs',import.meta.url).href)};process.on('message',async ({descriptor,identity})=>{try{const c=await connectEmbeddingBroker({descriptor,identity}); const v=await c.resolveConfiguration({providerId:'new-provider'});const {createHash}=await import('node:crypto');process.send({digest:createHash('sha256').update(v.key).digest('hex')});c.close();}catch(e){process.send({code:e.code});}process.disconnect();});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe','ipc']});const result=new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});child.send({descriptor:broker.descriptor,identity});assert.deepEqual(await result,{digest:(await import('node:crypto')).createHash('sha256').update(canary).digest('hex')});await new Promise(resolve=>child.once('exit',resolve));
 client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});locked=true;assert.equal((await client.readConfiguration({providerId:'new-provider'})).credentials.key.known,false);await assert.rejects(client.resolveConfiguration({providerId:'new-provider'}),{code:'secret_backend_locked'});
 await assert.rejects(connectEmbeddingBroker({descriptor:broker.descriptor,identity:{...identity,bootId:'wrong'}}),{code:'secret_backend_unavailable'});
 await assert.rejects(connectEmbeddingBroker({descriptor:{...broker.descriptor,token:'0'.repeat(64)},identity}),{code:'secret_backend_unavailable'});
 await assert.rejects(connectEmbeddingBroker({descriptor:{...broker.descriptor,bootId:'forged'},identity:{...identity,bootId:'forged'}}),{code:'secret_backend_unavailable'});
 await broker.close();await assert.rejects(client.resolveConfiguration({providerId:'new-provider'}),{code:'secret_backend_unavailable'});
 assert.equal((await readFile(join(home,'embedding-state.json'),'utf8')).includes(canary),false);assert.equal(JSON.stringify(broker.descriptor).includes(canary),false);
 }finally{client?.close();await broker?.close();await rm(home,{recursive:true,force:true});}
});
test('effect dispatch requires explicit host handler and exact fixture mapping',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-effects-'));const identity={instanceId:'i',bootId:'b'};const services=createEmbeddingServices({registryId:'fixture',identity});let effects=0;
 let broker,client;try{
 broker=await startEmbeddingBroker({services,home,identity,dispatchEffect:async request=>{if(request.kind!=='probe'||request.operation!=='detect')throw {code:'unsupported'};effects++;return {ok:true};}});client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});
 assert.deepEqual(await client.dispatchEffect({kind:'probe',operation:'detect',input:{}}),{ok:true});await assert.rejects(client.dispatchEffect({kind:'missing',operation:'detect',input:{}}),{code:'unsupported'});assert.equal(effects,1);client.close();await broker.close();
 broker=await startEmbeddingBroker({services,home,identity});client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});await assert.rejects(client.dispatchEffect({kind:'probe',operation:'detect',input:{}}),{code:'unsupported'});assert.equal(effects,1);
 }finally{client?.close();await broker?.close();await rm(home,{recursive:true,force:true});}
});
