import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
const code = wanted => error => error.code === wanted;
test('CAS, staged rotation, route use and discard preserve old credential',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embedding-')); const values=new Map(); let effects=0;
 const backend={put:async({bytes})=>{const handle=`key-${values.size}`;values.set(handle,Buffer.from(bytes));return {handle};},withSecret:async({handle},use)=>use(values.get(handle)),presence:async({handle})=>({known:true,value:values.has(handle)}),delete:async({handle})=>({deleted:values.delete(handle)})};
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:backend});
 try{
 const c=await s.readConfiguration({home,providerId:'opaque'});
 await assert.rejects(s.mutateConfiguration({home,providerId:'opaque',expectedConfigurationRevision:'stale'},async()=>{effects++;}),code('configuration_stale')); assert.equal(effects,0);
 const secret=await s.storeSecret({home,providerId:'opaque',inputId:'token',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from('canary-keychain')});
 await s.mutateConfiguration({home,providerId:'opaque',expectedConfigurationRevision:c.revision}, async tx=>tx.bindSecret('token',secret.handle));
 const applied=await s.readConfiguration({home,providerId:'opaque'}); const d=await s.beginConfigurationDraft({home,providerId:'opaque',expectedConfigurationRevision:applied.revision});
 await s.registerConfigurationUse({home,providerId:'opaque',revision:applied.revision,handle:'route'});
 await assert.rejects(s.commitConfigurationDraft({home,providerId:'opaque',draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision}),code('configuration_in_use'));
 await assert.rejects(s.discardSecret({home,handle:secret.handle}),code('secret_in_use'));
 await s.releaseConfigurationUse({home,providerId:'opaque',handle:'route'});
 assert.deepEqual(await s.discardConfigurationDraft({home,providerId:'opaque',draftId:d.draftId}),{discarded:true});
 assert.deepEqual(await s.discardConfigurationDraft({home,providerId:'opaque',draftId:d.draftId}),{discarded:false});
 assert.equal((await s.resolveConfiguration({home,providerId:'opaque'})).token,'canary-keychain');
 assert.equal((await readFile(join(home,'embedding-state.json'),'utf8')).includes('canary-keychain'),false);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('failed rotation, foreign scopes and conflicting drafts keep the old credential',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embedding-'));const values=new Map();let puts=0;
 const backend={put:async({bytes})=>{puts++;const handle=`opaque-${puts}`;values.set(handle,Buffer.from(bytes));return {handle};},withSecret:async({handle},use)=>use(values.get(handle)),presence:async({handle})=>({known:true,value:values.has(handle)}),delete:async({handle})=>({deleted:values.delete(handle)})};
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:backend});
 try{
 const base=await s.readConfiguration({home,providerId:'opaque',owner:'alice'});const r={home,providerId:'opaque',owner:'alice',expectedConfigurationRevision:base.revision,scopeId:base.scopeId,inputId:'token'};
 await assert.rejects(s.storeSecret({...r,scopeId:'foreign',bytes:Buffer.from('old')}),code('invalid_input'));assert.equal(puts,0);
 const old=await s.storeSecret({...r,bytes:Buffer.from('old')});await s.mutateConfiguration(r,tx=>tx.bindSecret('token',old.handle));
 const c=await s.readConfiguration(r);const a=await s.beginConfigurationDraft({...r,expectedConfigurationRevision:c.revision});const b=await s.beginConfigurationDraft({...r,expectedConfigurationRevision:c.revision});
 const dr={...r,draftId:a.draftId,expectedConfigurationRevision:a.configuration.revision};const staged=await s.storeSecret({...dr,bytes:Buffer.from('new')});
 await assert.rejects(s.mutateConfiguration(dr,async tx=>{await tx.bindSecret('token',staged.handle);throw Error('provider refused');}));
 assert.equal((await s.resolveConfiguration(r)).token,'old');
 await s.discardConfigurationDraft({...dr});assert.equal(values.has(old.handle),true);assert.equal(values.has(staged.handle),false);
 await s.commitConfigurationDraft({...r,draftId:b.draftId,expectedConfigurationRevision:b.configuration.revision});
 const foreign=await s.readConfiguration({...r,owner:'bob'});assert.notEqual(foreign.scopeId,c.scopeId);assert.equal(await s.resolveConfiguration({...r,owner:'bob'}),null);
 const missing=await s.discardSecret({home,handle:'foreign'});assert.equal(missing.discarded,false);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('backend lock never becomes absent or file fallback, and unbound discard repeats safely',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embedding-'));let deletes=0;let locked=false;
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:{put:async()=>{if(locked)throw {code:'secret_backend_locked',message:'never disclose this'};return {handle:'key'};},withSecret:async()=>{throw {code:'secret_backend_locked'};},presence:async()=>{throw {code:'secret_backend_locked'};},delete:async()=>{deletes++;return {deleted:true};}}});
 try{const c=await s.readConfiguration({home,providerId:'p'});const r={home,providerId:'p',inputId:'key',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from('canary')};locked=true;await assert.rejects(s.storeSecret(r),code('secret_backend_locked'));locked=false;const {handle}=await s.storeSecret(r);assert.equal((await s.discardSecret({home,handle})).discarded,true);assert.equal((await s.discardSecret({home,handle})).discarded,false);assert.equal(deletes,1);await assert.rejects(readFile(join(home,'secrets',handle)),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('default backend imports legacy references only; named owners require explicit migration',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-migrate-'));
 const {bindSetupText,bindSetupValue}=await import('../../packages/gozar-node/adapter-configuration.mjs');const {storeSecret}=await import('../../packages/gozar-node/secret-store.mjs');
 try{const {handle}=await storeSecret({home,value:'legacy-secret'});await bindSetupValue({home,adapterId:'legacy',actionId:'token',handle});await bindSetupText({home,adapterId:'legacy',actionId:'domain',value:'example.invalid'});
 const s=createEmbeddingServices({registryId:'fixture'});assert.deepEqual(await s.resolveConfiguration({home,providerId:'legacy'}),{domain:'example.invalid',token:'legacy-secret'});
 await assert.rejects(s.readConfiguration({home,providerId:'legacy',owner:'new-owner'}),code('configuration_migration_required'));
 const custom=createEmbeddingServices({registryId:'fixture-custom',secretBackend:{}});assert.deepEqual((await custom.readConfiguration({home,providerId:'legacy'})).credentials,{});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('draft binding promotion survives revision changes and commits; stale competing commit is inert',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-promotion-'));const values=new Map();let n=0;
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:{put:async({bytes})=>{const handle=`h${++n}`;values.set(handle,Buffer.from(bytes));return {handle};},withSecret:async({handle},use)=>use(values.get(handle)),presence:async({handle})=>({known:true,value:values.has(handle)}),delete:async({handle})=>({deleted:values.delete(handle)})}});
 try{const c=await s.readConfiguration({home,providerId:'p'});const r={home,providerId:'p',scopeId:c.scopeId};const d=await s.beginConfigurationDraft({...r,expectedConfigurationRevision:c.revision});const competing=await s.beginConfigurationDraft({...r,expectedConfigurationRevision:c.revision});
 const dr={...r,draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision};const h=await s.storeSecret({...dr,inputId:'key',bytes:Buffer.from('new-secret')});const changed=await s.mutateConfiguration(dr,tx=>tx.bindSecret('key',h.handle));
 const next=await s.mutateConfiguration({...dr,expectedConfigurationRevision:changed.configuration.revision},tx=>tx.bindText('domain','example.invalid'));
 const applied=await s.commitConfigurationDraft({...dr,expectedConfigurationRevision:next.configuration.revision});assert.notEqual(applied.revision,next.configuration.revision);assert.equal((await s.resolveConfiguration(r)).key,'new-secret');
 await assert.rejects(s.commitConfigurationDraft({...r,draftId:competing.draftId,expectedConfigurationRevision:competing.configuration.revision}),code('configuration_stale'));
 assert.equal((await s.resolveConfiguration(r)).key,'new-secret');await s.discardConfigurationDraft({...r,draftId:competing.draftId});assert.equal(values.has(h.handle),true);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('approved draft clear releases the reference only after commit; applied use blocks deletion',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-clear-'));const {clearConfigurationInput,clearInputActions}=await import('../../packages/gozar-node/embedding-setup.mjs');let deleted=0;
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:{put:async()=>({handle:'h'}),withSecret:async(_,use)=>use(Buffer.from('secret')),presence:async()=>({known:true,value:true}),delete:async()=>{deleted++;return {deleted:true};}}});
 try{const c=await s.readConfiguration({home,providerId:'p'});const r={home,providerId:'p',scopeId:c.scopeId,expectedConfigurationRevision:c.revision};const stored=await s.storeSecret({...r,inputId:'key',bytes:Buffer.from('secret')});assert.equal(stored.configurationRevision,c.revision);const applied=await s.mutateConfiguration(r,tx=>tx.bindSecret('key','h'));const d=await s.beginConfigurationDraft({...r,expectedConfigurationRevision:applied.configuration.revision});const action=clearInputActions(d.configuration)[0];
 const request={...r,draftId:d.draftId,inputId:'key',expectedConfigurationRevision:d.configuration.revision,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision}};
 const adapter={id:'p',definition:{capabilities:{}},detect:async()=>({state:'ready',facts:{}}),properties:()=>({}),setupActions:()=>[]};const next=await clearConfigurationInput(request,{embeddingServices:s,adapters:[adapter],readContext:{configuration:async()=>null}});
 await assert.rejects(s.discardSecret({home,handle:'h'}),code('secret_in_use'));assert.equal((await s.resolveConfiguration(r)).key,'secret');await s.commitConfigurationDraft({...r,draftId:d.draftId,expectedConfigurationRevision:next.revision});assert.equal((await s.discardSecret({home,handle:'h'})).discarded,true);assert.equal(deleted,1);
 }finally{await rm(home,{recursive:true,force:true});}
});
