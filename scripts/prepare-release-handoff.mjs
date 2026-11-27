#!/usr/bin/env node
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {join,resolve,relative,isAbsolute,basename,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {completeFixtureLifecycle,installedStepFailed,optionalPackageNames} from './release-installed-journey.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export function parsePackOutput(text){
 let value;
 try{value=JSON.parse(text);}
 catch(cause){throw new Error('Unknown or ambiguous npm pack output: expected valid JSON',{cause});}
 const entries=Array.isArray(value)?value:value?.filename?[value]:Object.values(value??{});
 if(entries.length!==1||typeof entries[0]?.filename!=='string'||entries[0].name!=='@tnunamak/gozar'||
    typeof entries[0].version!=='string'||!entries[0].version.trim())throw new Error('Unknown or ambiguous npm pack output');
 const entry=entries[0];
 if(basename(entry.filename)!==entry.filename||!entry.filename.endsWith('.tgz'))throw new Error('Unsafe npm archive filename');
 return entry;
}
function inventory(bytes,onPackage=()=>{}){
 const data=gunzipSync(bytes,{maxOutputLength:256*1024*1024}),members=[];let at=0,pax=null,ended=false;
 const str=b=>b.toString().replace(/\0.*$/s,'');
 const number=b=>{const s=str(b).trim();if(!/^[0-7]*$/.test(s))throw new Error('Unsupported tar number');return parseInt(s||'0',8);};
 while(at+512<=data.length){
  const h=data.subarray(at,at+512);at+=512;
  if(h.every(x=>x===0)){ended=true;break;}
  if(number(h.subarray(148,156))!==[...h].reduce((n,b,i)=>n+(i>=148&&i<156?32:b),0))throw new Error('Tar checksum mismatch');
  const size=number(h.subarray(124,136));
  if(!Number.isSafeInteger(size)||at+size>data.length)throw new Error('Truncated archive');
  const body=data.subarray(at,at+size);at+=Math.ceil(size/512)*512;
  const type=h[156];
  if(type===120){
   if(pax)throw new Error('Repeated pax header');pax={};let pos=0;
   while(pos<body.length){
    const space=body.indexOf(32,pos),len=Number(body.subarray(pos,space).toString());
    if(space<0||!Number.isSafeInteger(len)||len<=space-pos+1||pos+len>body.length||body[pos+len-1]!==10)throw new Error('Invalid pax header');
    const entry=body.subarray(space+1,pos+len-1).toString(),eq=entry.indexOf('=');
    if(eq<0)throw new Error('Invalid pax entry');
    const key=entry.slice(0,eq);
    if(!['path','mtime','atime','ctime','uid','gid','uname','gname'].includes(key))throw new Error('Unsupported pax field');
    pax[key]=entry.slice(eq+1);pos+=len;
   }
   continue;
  }
  const prefix=str(h.subarray(345,500)),name=pax?.path??((prefix?prefix+'/':'')+str(h.subarray(0,100)));pax=null;
  if(!name.startsWith('package/')||name.includes('\\')||name.includes('\0'))throw new Error('Unsafe archive member');
  const path=name.slice(8).replace(/\/$/,'');
  if(!path&&type===53)continue;
  if(!path||path.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Unsafe archive path');
  if(type===53)continue;
  if(![0,48].includes(type)||members.some(m=>m.path===path))throw new Error('Nonregular or duplicate archive member');
  members.push({path,bytes:size,sha256:hash(body)});
  if(path==='package.json')onPackage(body);
 }
 if(!ended||pax||data.subarray(at).some(x=>x!==0)||!members.length)throw new Error('Invalid archive end');
 return members;
}
function checkGate(gate,sourceSha){
 if(gate?.schemaVersion!==1||gate.kind!=='gozar-offline-host-gate'||gate.status!=='passed'||gate.sourceSha!==sourceSha||
    !['node','rust'].every(name=>gate[name]?.exitCode===0&&gate[name]?.failed===0&&Number.isSafeInteger(gate[name]?.passed)&&gate[name].passed>0))
  throw new Error('Unknown, mismatched or unsuccessful host gate receipt');
}
const defaultRun=(command,args,options)=>spawnSync(command,args,{...options,encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024});
function environment(){
 const env={...process.env,npm_config_ignore_scripts:'false',NPM_CONFIG_IGNORE_SCRIPTS:'false',
  npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false'};
 delete env.NODE_OPTIONS;delete env.NODE_PATH;
 return env;
}
export async function prepareReleaseHandoff({root,sourceSha,gateReceipt,outputDirectory},{run=defaultRun}={}){
 if(!/^[a-f0-9]{40}$/.test(sourceSha??'')||![root,gateReceipt,outputDirectory].every(x=>typeof x==='string'&&x))throw new Error('Explicit root, SHA, gate receipt and output directory required');
 root=await realpath(root);
 const gatePath=resolve(gateReceipt),gateBytes=await readFile(gatePath),gate=JSON.parse(gateBytes);
 checkGate(gate,sourceSha);
 const requested=resolve(outputDirectory),output=join(await realpath(dirname(requested)),basename(requested));
 const rel=relative(root,output);
 if(!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw new Error('Output must be outside source');
 const steps=[],env=environment();
 async function call(command,args){
  const result=await run(command,args,{cwd:root,env});
  steps.push({command,args,result});
  if(result.status!==0||result.signal||result.error){const error=new Error('Release subprocess failed');error.result={...result,error:result.error?String(result.error):undefined};throw error;}
  return result.stdout;
 }
 async function clean(){
  if((await call('git',['rev-parse','HEAD'])).trim()!==sourceSha)throw new Error('Source SHA mismatch');
  if((await call('git',['status','--porcelain=v1','--untracked-files=all'])).trim())throw new Error('Source must be clean');
 }
 await clean();
 await mkdir(output,{mode:0o700});
 const manifestPath=join(output,'manifest.json');
 const manifest={schemaVersion:1,kind:'gozar-release-handoff',status:'failed',sourceSha,root,gateReceipt:gatePath,gateReceiptSha256:hash(gateBytes),
  outputDirectory:output,publishCommand:null,steps,
  limits:['ngrok rows are detect-only; no credentialed/live-provider acceptance claimed','consumer journey unresolved until exact artifact PASS receipt','host receipts are trusted local evidence, not cryptographic attestations']};
 try{
  const packed=parsePackOutput(await call('npm',['pack','--json','--ignore-scripts=false','--pack-destination',output]));
  await clean();
  const tarball=join(output,packed.filename),info=await lstat(tarball);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Archive must be regular');
  const bytes=await readFile(tarball);
  Object.assign(manifest,{status:'prepared-consumer-pending',tarball,sha256:hash(bytes),archiveBytes:bytes.length,
   package:{name:packed.name,version:packed.version},members:inventory(bytes)});
  await save(manifestPath,manifest);return manifest;
 }catch(error){manifest.failure={message:error.message,code:error.code??null,result:error.result??null};await save(manifestPath,manifest);throw error;}
}
function checkConsumer(receipt,manifest,archivePackage){
 const reject=()=>{throw new Error('Unknown, mismatched or incomplete real consumer receipt');};
 const expectedOptional=optionalPackageNames(archivePackage).sort();
 const actualOptional=receipt?.optionalDependenciesAbsent;
 const expectedMembers=new Map(manifest.members.map(member=>[member.path,member]));
 if(receipt?.schemaVersion!==1||receipt.kind!=='gozar-installed-consumer'||receipt.status!=='passed'||
    receipt.execution!=='real-installed-archive'||receipt.sourceSha!==manifest.sourceSha||receipt.sha256!==manifest.sha256||
    receipt.sourceShaProvenance!=='caller-supplied, not authenticated by archive'||receipt.failure||receipt.installedBytes!==true||
    !Array.isArray(actualOptional)||!expectedOptional.includes('@ngrok/ngrok')||
    JSON.stringify([...actualOptional].sort())!==JSON.stringify(expectedOptional)||
    !Array.isArray(receipt.members)||receipt.members.length!==expectedMembers.size||
    !Array.isArray(receipt.steps)||receipt.steps.map(step=>step?.name).join(',')!=='install,screen,lifecycle'||
    receipt.steps.some(step=>installedStepFailed(step.result))||!completeFixtureLifecycle(receipt.lifecycle))reject();
 const seen=new Set();
 for(const member of receipt.members){
  const wanted=expectedMembers.get(member?.path);
  if(!wanted||seen.has(member.path)||wanted.bytes!==member.bytes||wanted.sha256!==member.sha256)reject();
  seen.add(member.path);
 }
 const screen=receipt.steps[1].result.stdout;
 if(typeof screen!=='string'||!screen.startsWith('Remote access\n')||!screen.includes('Host inputs:')||!screen.includes('Choice:'))reject();
 let observed;
 try{observed=JSON.parse(receipt.steps[2].result.stdout);}catch{reject();}
 if(JSON.stringify(observed)!==JSON.stringify(receipt.lifecycle))reject();
}
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
export async function finalizeReleaseHandoff({manifestPath,consumerReceipt}){
 const manifest=await json(manifestPath);
 if(manifest?.schemaVersion!==1||manifest.kind!=='gozar-release-handoff'||manifest.status!=='prepared-consumer-pending')throw new Error('Unknown handoff manifest');
 const info=await lstat(manifest.tarball);
 if(!info.isFile()||info.isSymbolicLink())throw new Error('Archive must be regular');
 const bytes=await readFile(manifest.tarball);
 if(hash(bytes)!==manifest.sha256)throw new Error('Archive digest changed');
 let archivePackage;
 const members=inventory(bytes,body=>{archivePackage=JSON.parse(body);});
 if(!archivePackage||JSON.stringify(members)!==JSON.stringify(manifest.members))throw new Error('Archive inventory changed');
 const gateBytes=await readFile(manifest.gateReceipt);
 if(hash(gateBytes)!==manifest.gateReceiptSha256)throw new Error('Host gate receipt changed');
 checkGate(JSON.parse(gateBytes),manifest.sourceSha);
 const receiptBytes=await readFile(consumerReceipt),receipt=JSON.parse(receiptBytes);checkConsumer(receipt,manifest,archivePackage);
 manifest.status='qualified-artifact';manifest.consumerReceipt=resolve(consumerReceipt);manifest.consumerReceiptSha256=hash(receiptBytes);
 manifest.limits=manifest.limits.filter(x=>!x.startsWith('consumer journey unresolved'));
 manifest.publishCommand='npm publish '+quote(manifest.tarball)+' --access public --ignore-scripts';
 await save(manifestPath,manifest);return manifest;
}
function args(argv){
 const values={},keys={'--root':'root','--source-sha':'sourceSha','--gate-receipt':'gateReceipt','--output-directory':'outputDirectory','--manifest':'manifestPath','--consumer-receipt':'consumerReceipt'};
 for(let i=0;i<argv.length;i+=2){
  const key=keys[argv[i]],value=argv[i+1];if(!key||!value||value.startsWith('--')||key in values)throw new Error('Invalid arguments');
  values[key]=value;
 }
 return values;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [mode,...argv]=process.argv.slice(2),input=args(argv);
  const result=mode==='prepare'?await prepareReleaseHandoff(input):mode==='finalize'?await finalizeReleaseHandoff(input):(()=>{throw new Error('Choose prepare or finalize');})();
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
