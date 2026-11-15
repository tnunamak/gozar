import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,lstat,mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {configurationFor} from '../../packages/gozar-node/embedding-state.mjs';

test('common configuration projection preserves defaults, saved observations and clone isolation',()=>{
  const saved={revision:'r1',scopeId:'s1',values:{label:'kept'},credentials:{
    missing:{known:false,reason:'secret_backend_locked'},retained:{known:false,reason:'secret_backend_locked'}}};
  const before=structuredClone(saved);
  const declared=[{id:'missing',secret:true},{id:'absent',secret:true}];
  const actions=[{id:'value',kind:'provide-value'},{id:'instructions',kind:'instructions'}];
  const result=configurationFor(actions,saved,declared);
  assert.deepEqual(result.credentials,{missing:{known:false,reason:'secret_backend_locked'},
    absent:{known:true,value:false},retained:{known:false,reason:'secret_backend_locked'}});
  assert.equal(result.revision,saved.revision);assert.equal(result.scopeId,saved.scopeId);
  assert.deepEqual(result.values,saved.values);assert.deepEqual(result.actions,[actions[0]]);
  assert.deepEqual(result.inputRequirements,declared);
  result.credentials.missing.reason='changed';result.credentials.retained.reason='changed';
  result.inputRequirements[0].id='changed';
  assert.deepEqual(saved,before);assert.equal(declared[0].id,'missing');
  assert.deepEqual(configurationFor([],saved,[]).credentials,before.credentials);
});

class Backend {
  locked=false; entries=new Map(); deletes=[]; puts=0;
  async put({scopeId,bytes}){this.puts++;const handle=randomUUID();this.entries.set(handle,{scopeId,bytes:new Uint8Array(bytes)});return {handle};}
  async withSecret({scopeId,handle},use){
    if(this.locked)throw Object.assign(new Error('fixture locked'),{code:'secret_backend_locked'});
    const row=this.entries.get(handle);assert.ok(row);assert.equal(row.scopeId,scopeId);return use(new Uint8Array(row.bytes));
  }
  async presence({scopeId,handle}){return this.locked?{known:false,reason:'secret_backend_locked'}:{known:true,value:this.entries.get(handle)?.scopeId===scopeId};}
  async delete({scopeId,handle}){
    const row=this.entries.get(handle);if(row)assert.equal(row.scopeId,scopeId);
    this.deletes.push(handle);return {deleted:this.entries.delete(handle)};
  }
}
const approval=action=>({kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest});
async function noCanary(root,canaries){
  for(const entry of await readdir(root,{withFileTypes:true})){
    const path=join(root,entry.name);assert.ok(!entry.isSymbolicLink());
    if(entry.isDirectory())await noCanary(path,canaries);
    else if(entry.isFile()){const bytes=await readFile(path);for(const canary of canaries)assert.ok(!bytes.includes(Buffer.from(canary)),'canary leaked to owned output');}
  }
}

test('public applied-clear-replacement locked draft keeps observations and cleans only draft custody',async t=>{
  const parent=join(homedir(),'.tmp');await mkdir(parent,{recursive:true,mode:0o700});
  const stat=await lstat(parent);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  assert.equal(stat.mode&0o777,0o700);if(process.getuid)assert.equal(stat.uid,process.getuid());
  const root=await mkdtemp(join(parent,'gozar-observation-')),home=join(root,'home'),owner='fixture-owner';
  const backend=new Backend(),canaries=[randomUUID(),randomUUID()];
  const foreignHandle=randomUUID(),foreignRow={scopeId:'foreign-fixture',bytes:new Uint8Array([7,8,9])};
  backend.entries.set(foreignHandle,foreignRow);
  let registry,api,base,draft;
  t.after(async()=>{
    backend.locked=false;
    try{
      if(draft)await api.discardConfigurationDraft({...base,draftId:draft.draftId});
      assert.equal(backend.entries.get(foreignHandle),foreignRow);
      assert.ok(!backend.deletes.includes(foreignHandle));
    }finally{
      try{await registry?.cleanup();}finally{await rm(root,{recursive:true,force:true});}
      for(const [handle,row] of backend.entries)if(row!==foreignRow)backend.entries.delete(handle);
    }
  });
  const id='fixture-'+randomUUID();
  registry=await fakeRegistry({id,dir:join(root,'registry'),kinds:['attached'],reach:'this-device',transport:'http',
    setupActions:[{id:'fixture.input',kind:'provide-secret',label:'Credential',secretLabel:'Credential',required:true,
      digest:'fixture-v1',disclosure:{revision:'fixture-v1',text:'Fixture custody',links:[]}}]});
  const options={manifest:registry.manifest,root:registry.root,secretBackend:backend,
    hostCapabilities:{'secrets.backend':{known:true,value:true},'runtime.attached':{known:true,value:true}}};
  api=createGozar(options);base={home,owner,providerId:id};
  const inventory=async instance=>(await instance.listProviders({home,owner})).providers.find(p=>p.providerId===id).configuration;
  let applied=await inventory(api);
  draft=await api.beginConfigurationDraft({...base,expectedConfigurationRevision:applied.revision});
  const provide=async(text)=>{
    const c=draft.configuration,action=c.actions.find(a=>a.kind==='provide-secret');assert.ok(action);
    const field=c.inputRequirements.find(f=>f.actionId===action.id);assert.ok(field);
    const staged=await api.storeSecret({...base,draftId:draft.draftId,expectedConfigurationRevision:c.revision,
      scopeId:draft.scopeId,inputId:field.id,bytes:new TextEncoder().encode(text)});
    await api.runSetupAction({...base,draftId:draft.draftId,expectedConfigurationRevision:c.revision,
      actionId:action.id,secretHandle:staged.handle,approval:approval(action)});
    draft=await api.readConfigurationDraft({...base,draftId:draft.draftId});
    return {handle:staged.handle,inputId:field.id};
  };
  const initial=await provide(canaries[0]);
  applied=await api.commitConfigurationDraft({...base,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
  draft=null;
  const appliedBefore=structuredClone(await inventory(api)),initialRow=backend.entries.get(initial.handle);
  assert.ok(initialRow);
  draft=await api.beginConfigurationDraft({...base,expectedConfigurationRevision:applied.revision});
  const clear=draft.configuration.actions.find(a=>a.kind==='clear-input'&&a.inputId===initial.inputId);assert.ok(clear);
  const oldApproval=approval(clear),beforeClear=backend.deletes.length;
  draft.configuration=await api.clearConfigurationInput({...base,draftId:draft.draftId,inputId:clear.inputId,
    expectedConfigurationRevision:draft.configuration.revision,approval:oldApproval});
  assert.equal(backend.deletes.length,beforeClear,'clearing inherited applied reference preserves custody');
  assert.equal(backend.entries.get(initial.handle),initialRow);
  const replacement=await provide(canaries[1]),revision=draft.configuration.revision;
  backend.locked=true;
  for(let i=0;i<2;i++){
    const read=await api.readConfigurationDraft({...base,draftId:draft.draftId});
    assert.equal(read.configuration.revision,revision);
    assert.ok(Object.keys(read.configuration.credentials).length>0);
    assert.deepEqual(read.configuration.credentials[replacement.inputId],{known:false,reason:'secret_backend_locked'});
  }
  backend.locked=false;
  const fresh=createGozar(options);
  draft=await fresh.readConfigurationDraft({...base,draftId:draft.draftId});
  assert.equal(draft.configuration.revision,revision);
  assert.deepEqual(draft.configuration.credentials[replacement.inputId],{known:true,value:true});
  assert.deepEqual(await inventory(fresh),appliedBefore,'draft rotation leaves applied binding intact');
  const writes={puts:backend.puts,deletes:backend.deletes.length};
  await assert.rejects(fresh.clearConfigurationInput({...base,draftId:draft.draftId,inputId:replacement.inputId,
    expectedConfigurationRevision:revision,approval:oldApproval}));
  assert.deepEqual({puts:backend.puts,deletes:backend.deletes.length},writes,'stale approval performs zero custody writes');
  draft=await fresh.readConfigurationDraft({...base,draftId:draft.draftId});
  assert.equal(draft.configuration.revision,revision);
  const currentClear=draft.configuration.actions.find(a=>a.kind==='clear-input'&&a.inputId===replacement.inputId);assert.ok(currentClear);
  await fresh.clearConfigurationInput({...base,draftId:draft.draftId,inputId:replacement.inputId,
    expectedConfigurationRevision:revision,approval:approval(currentClear)});
  // A second approved clear happened in this draft; discard must clean draft-owned custody,
  // not preserve it merely because the inherited applied reference was preserved above.
  await fresh.discardConfigurationDraft({...base,draftId:draft.draftId});
  const deletionsAfterDiscard=[...backend.deletes];
  await fresh.discardConfigurationDraft({...base,draftId:draft.draftId});
  draft=null;
  assert.deepEqual(backend.deletes,deletionsAfterDiscard,'repeated discard must not repeat custody writes');
  assert.ok(!backend.entries.has(replacement.handle),'discard removes draft-owned replacement custody');
  assert.ok(backend.deletes.includes(replacement.handle));
  assert.ok(backend.deletes.every(handle=>handle===replacement.handle),'never delete applied or foreign custody');
  assert.equal(backend.entries.get(initial.handle),initialRow);
  assert.equal(backend.entries.get(foreignHandle),foreignRow);
  assert.deepEqual(await inventory(fresh),appliedBefore);
  await noCanary(root,canaries);
});
