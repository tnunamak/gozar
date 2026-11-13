import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';
test('registry identity survives relocation and changes with adapter code or data',async()=>{
 const parent=join(homedir(),'.tmp','gz040-b1');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'reg-'));
 try{await cp(new URL('../../adapters/',import.meta.url),join(root,'a'),{recursive:true});await cp(join(root,'a'),join(root,'b'),{recursive:true});
 const options=name=>({manifest:join(root,name,'manifest.json')});
 const id=await registryIdentity(options('a'));assert.equal(await registryIdentity(options('b')),id);
 const manifest=JSON.parse(await readFile(join(root,'b','manifest.json'),'utf8'));
 const module=join(root,'b',manifest.providers[0].module);await writeFile(module,(await readFile(module,'utf8'))+'\n// changed\n');
 assert.notEqual(await registryIdentity(options('b')),id);
 }finally{await rm(root,{recursive:true,force:true});}
});
