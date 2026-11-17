import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {prepareReleaseHandoff,finalizeReleaseHandoff,parsePackOutput} from '../../scripts/prepare-release-handoff.mjs';

const sha='a'.repeat(40);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function archive(){
 const body=Buffer.from('{"name":"@tnunamak/gozar","version":"0.4.0"}'),h=Buffer.alloc(512);
 h.write('package/package.json');h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
 h.write(body.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);
 h.write([...h].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
 return gzipSync(Buffer.concat([h,body,Buffer.alloc(512-body.length),Buffer.alloc(1024)]));
}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'handoff-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=join(dir,'source');await mkdir(root);
 const gate={schemaVersion:1,kind:'gozar-offline-host-gate',sourceSha:sha,status:'passed',
  node:{exitCode:0,failed:0,passed:1084},rust:{exitCode:0,failed:0,passed:1}};
 const gateReceipt=join(dir,'gate.json');await writeFile(gateReceipt,JSON.stringify(gate));
 return {dir,root,gate,gateReceipt,outputDirectory:join(dir,'output'),bytes:archive()};
}
function injected(f,{form='array',dirty=false,fault=false}={}){
 const calls=[];
 return {calls,run:async(command,args,options)=>{
  calls.push({command,args,options});
  if(command==='git')return {status:0,stdout:args.includes('rev-parse')?sha+'\n':dirty?' M changed\n':'',stderr:''};
  if(fault)return {status:23,stdout:'pack stdout',stderr:'prepack failed'};
  await writeFile(join(f.outputDirectory,'gozar-0.4.0.tgz'),f.bytes);
  const entry={filename:'gozar-0.4.0.tgz',name:'@tnunamak/gozar',version:'0.4.0'};
  return {status:0,stdout:JSON.stringify(form==='array'?[entry]:entry),stderr:''};
 }};
}
for(const form of ['array','object'])test('ordinary pack preserves prepack and records actual archive identity: '+form,async t=>{
 const f=await fixture(t),stub=injected(f,{form});
 const result=await prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run});
 assert.equal(result.status,'prepared-consumer-pending');assert.equal(result.sha256,hash(f.bytes));
 assert.equal(result.publishCommand,null);assert.deepEqual(result.members.map(x=>x.path),['package.json']);
 const pack=stub.calls.find(c=>c.command==='npm');assert.ok(pack);
 assert.ok(pack.args.includes('--ignore-scripts=false'));assert.ok(!pack.args.includes('--ignore-scripts'));
 assert.equal(pack.args[0],'pack');assert.equal(pack.options.env.npm_config_ignore_scripts,'false');
});
test('ambiguous npm output is refused',()=>{
 assert.throws(()=>parsePackOutput('[{},{}]'));
 assert.throws(()=>parsePackOutput('{"unexpected":true}'));
});
for(const kind of ['unknown','wrong-sha','nonzero'])test('gate refuses '+kind+' before pack',async t=>{
 const f=await fixture(t),stub=injected(f);
 const gate=kind==='unknown'?{status:'passed'}:kind==='wrong-sha'?{...f.gate,sourceSha:'b'.repeat(40)}:{...f.gate,rust:{exitCode:1,failed:1,passed:0}};
 await writeFile(f.gateReceipt,JSON.stringify(gate));
 await assert.rejects(prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run}),/gate/i);
 assert.equal(stub.calls.some(c=>c.command==='npm'),false);
});
test('dirty source refuses ordinary pack',async t=>{
 const f=await fixture(t),stub=injected(f,{dirty:true});
 await assert.rejects(prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run}),/clean/i);
 assert.equal(stub.calls.some(c=>c.command==='npm'),false);
});
test('prepack failure remains exact and never becomes prepared',async t=>{
 const f=await fixture(t),stub=injected(f,{fault:true});
 await assert.rejects(prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run}),e=>e.result.status===23&&e.result.stderr==='prepack failed');
 const result=JSON.parse(await readFile(join(f.outputDirectory,'manifest.json'),'utf8'));
 assert.equal(result.status,'failed');assert.equal(result.publishCommand,null);
});
test('changed archive refuses finalization before trusting consumer receipt',async t=>{
 const f=await fixture(t),stub=injected(f);
 const result=await prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run});
 await writeFile(result.tarball,'changed bytes');
 await assert.rejects(finalizeReleaseHandoff({manifestPath:join(f.outputDirectory,'manifest.json'),consumerReceipt:join(f.dir,'absent.json')}),/digest/i);
});
test('unknown consumer PASS cannot produce a publish command',async t=>{
 const f=await fixture(t),stub=injected(f);
 await prepareReleaseHandoff({...f,sourceSha:sha},{run:stub.run});
 const receipt=join(f.dir,'consumer.json');await writeFile(receipt,JSON.stringify({status:'passed'}));
 await assert.rejects(finalizeReleaseHandoff({manifestPath:join(f.outputDirectory,'manifest.json'),consumerReceipt:receipt}),/consumer/i);
 const result=JSON.parse(await readFile(join(f.outputDirectory,'manifest.json'),'utf8'));
 assert.equal(result.publishCommand,null);
});
