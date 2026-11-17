import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {startTokenProcess} from '../../adapters/providers/_shared/token-process.mjs';
test('credential pipe reaches a local stand-in without bytes in argv or environment',async()=>{
 const parent=join(homedir(),'.tmp','gz040-b1');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'pipe-')),canary='local-process-canary-27471';let runtime;
 try{
  const script=join(root,'reader.mjs'),output=join(root,'observed.json');
  await writeFile(script,`import{readFileSync,writeFileSync}from'node:fs';const token=readFileSync(process.argv.at(-1),'utf8');writeFileSync(${JSON.stringify(output)},JSON.stringify({matched:token===${JSON.stringify(canary)},argv:process.argv,env:process.env}));setInterval(()=>{},1000);`);
  runtime=await startTokenProcess({program:process.execPath,args:[script],token:canary});
  let observed;for(let n=0;n<100;n++){try{observed=JSON.parse(await readFile(output,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  assert.equal(observed.matched,true);assert.doesNotMatch(JSON.stringify([observed.argv,observed.env]),new RegExp(canary));assert.equal(await runtime.alive(),true);
  await runtime.close();assert.equal(await runtime.alive(),false);
 }finally{await runtime?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});
