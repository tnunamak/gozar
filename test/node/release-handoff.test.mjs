import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {prepareReleaseHandoff,finalizeReleaseHandoff,parsePackOutput} from '../../scripts/prepare-release-handoff.mjs';

import {runInstalledJourney} from '../../scripts/release-installed-journey.mjs';

const sha='a'.repeat(40);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function archive(files={'package.json':'{"name":"@tnunamak/gozar","version":"0.4.0"}'}){
 const parts=[];
 for(const [name,text] of Object.entries(files)){
  const body=Buffer.from(text),h=Buffer.alloc(512);
  h.write('package/'+name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
  h.write(body.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);
  h.write([...h].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  parts.push(h,body,Buffer.alloc((512-body.length%512)%512));
 }
 return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
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

test('actual installed journey qualifies its exact fixture archive without translating evidence',async t=>{
 const f=await fixture(t),artifact={
  'package.json':JSON.stringify({name:'@tnunamak/gozar',version:'0.4.0',peerDependencies:{'@ngrok/ngrok':'1.0.0'},peerDependenciesMeta:{'@ngrok/ngrok':{optional:true}}}),
  'examples/remote-access-screen.mjs':"console.log('Remote access\\nHost inputs: {}\\nChoice: Fixture');",
  'examples/provider-lifecycle-fixture.mjs':'console.log(JSON.stringify('+JSON.stringify({
   fixtureOnly:true,providerId:'fixture-handoff',proof:{status:'verified'},cleanup:{state:'confirmed'},
   resourceLedger:{foreignPreserved:true,ownedAfter:[]},statusPreservedProofTime:true,
   events:['setup','start','proof','stop','cleanup'],
  })+'));',
 };
 f.bytes=archive(artifact);
 const prepared=await prepareReleaseHandoff({...f,sourceSha:sha},{run:injected(f).run});
 const journeyDir=join(f.dir,'journey');
 const input={tarball:prepared.tarball,sha256:prepared.sha256,sourceSha:sha,outputDirectory:journeyDir};
 const receiptPath=join(journeyDir,'result.json'),manifestPath=join(f.outputDirectory,'manifest.json');
 let receipt;
 try{
  receipt=await runInstalledJourney(input);
  for(const alter of [
   bad=>{bad.status='failed';},
   bad=>{bad.members[0].path='unknown-receipt-member.txt';},
   bad=>{bad.steps[2].result.stdout='{';},
   bad=>{bad.steps[1].result.stdout='Remote access\nChoice: Fixture';},
   bad=>{bad.steps[1].result.stdout='Remote access\nHost inputs: {}';},
   bad=>{bad.installedBytes=false;},
   bad=>{bad.execution='injected-process-runner';},
   bad=>{bad.sourceShaProvenance='authenticated';},
   bad=>{bad.schemaVersion=2;},
   bad=>{bad.kind='unknown-consumer';},
   bad=>{bad.failure={message:'retained fixture failure'};},
   bad=>{bad.members[0].sha256='e'.repeat(64);},
   bad=>{bad.members[0].bytes++;},
   bad=>{bad.members[1]=structuredClone(bad.members[0]);},
   bad=>{[bad.steps[0],bad.steps[1]]=[bad.steps[1],bad.steps[0]];},
   bad=>{bad.steps[1].name='other-screen';},
   bad=>{bad.steps[1].result.stdout='not the screen';},
   bad=>{bad.steps[2].result.stdout=JSON.stringify({...bad.lifecycle,extra:'mismatched observation'});},
   bad=>{bad.lifecycle.proof.status='unverified';},
   bad=>{bad.lifecycle.resourceLedger.foreignPreserved=false;},
   bad=>{bad.sourceSha='b'.repeat(40);},
   bad=>{bad.sha256='c'.repeat(64);},
   bad=>{bad.steps.find(step=>step.name==='screen').result.timedOut=true;},
   bad=>{bad.steps.find(step=>step.name==='install').result.status=1;},
   bad=>{bad.steps.find(step=>step.name==='lifecycle').result.overflow=true;},
   bad=>{bad.members.pop();},
   bad=>{bad.members.push({path:'extra.txt',sha256:'d'.repeat(64),bytes:1});},
   bad=>{bad.optionalDependenciesAbsent=[];},
   bad=>{bad.lifecycle.cleanup.state='unconfirmed';},
  ]){
   const bad=structuredClone(receipt);alter(bad);
   await writeFile(receiptPath,JSON.stringify(bad));
   await assert.rejects(finalizeReleaseHandoff({manifestPath,consumerReceipt:receiptPath}),/consumer/i);
  }
  await writeFile(receiptPath,JSON.stringify(receipt));
  const result=await finalizeReleaseHandoff({manifestPath,consumerReceipt:receiptPath});
  assert.equal(result.status,'qualified-artifact');
  assert.equal(result.sha256,prepared.sha256);
 }finally{
  const record=receipt??await readFile(receiptPath,'utf8').then(JSON.parse,()=>null);
  if(record?.scratch)await rm(record.scratch,{recursive:true,force:true});
 }
});
