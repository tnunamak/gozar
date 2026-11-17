#!/usr/bin/env node
// Offline artifact consumer. Never packs source or runs the repository gate.
import {readFile,writeFile,mkdir,mkdtemp,lstat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const text=bytes=>bytes.toString('utf8').replace(/\0.*$/s,'');
const octal=bytes=>{
 const value=text(bytes).trim();if(!/^[0-7]*$/.test(value))throw new Error('Unsupported tar number');
 const n=parseInt(value||'0',8);if(!Number.isSafeInteger(n))throw new Error('Invalid tar size');return n;
};
function archiveFiles(bytes){
 const raw=gunzipSync(bytes,{maxOutputLength:256*1024*1024}),files=new Map();let offset=0,pax=null,ended=false;
 while(offset+512<=raw.length){
  const header=raw.subarray(offset,offset+512);offset+=512;
  if(header.every(b=>b===0)){ended=true;break;}
  const checksum=octal(header.subarray(148,156));
  const sum=[...header].reduce((n,b,i)=>n+(i>=148&&i<156?32:b),0);
  if(sum!==checksum)throw new Error('Invalid tar checksum');
  const size=octal(header.subarray(124,136)),end=offset+size;
  if(end>raw.length)throw new Error('Truncated archive');
  const body=raw.subarray(offset,end);offset+=Math.ceil(size/512)*512;
  const kind=header[156],prefix=text(header.subarray(345,500));
  let name=(prefix?prefix+'/':'')+text(header.subarray(0,100));
  if(kind===120){
   if(pax)throw new Error('Repeated pax header');pax={};let i=0;
   while(i<body.length){
    const space=body.indexOf(32,i);if(space<0)throw new Error('Invalid pax header');
    const length=Number(body.subarray(i,space).toString());
    if(!Number.isSafeInteger(length)||length<=space-i+1||i+length>body.length)throw new Error('Invalid pax length');
    const entry=body.subarray(space+1,i+length-1).toString(),eq=entry.indexOf('=');
    if(eq<0||body[i+length-1]!==10)throw new Error('Invalid pax entry');
    pax[entry.slice(0,eq)]=entry.slice(eq+1);i+=length;
   }
   continue;
  }
  if(pax){
   if(Object.keys(pax).some(k=>!['path','mtime','atime','ctime','uid','gid','uname','gname'].includes(k)))throw new Error('Unsupported pax metadata');
   name=pax.path??name;pax=null;
  }
  if(!name.startsWith('package/')||name.includes('\\')||name.includes('\0'))throw new Error('Unsafe archive member');
  const path=name.slice(8).replace(/\/$/,'');
  if(!path&&kind===53)continue;
  if(!path||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe archive path');
  if(kind===53)continue;
  if(kind!==0&&kind!==48)throw new Error('Archive contains nonregular member');
  if(files.has(path))throw new Error('Duplicate archive member');
  files.set(path,Buffer.from(body));
 }
 if(!ended||pax||raw.subarray(offset).some(b=>b!==0))throw new Error('Invalid archive terminator');
 return files;
}
export function runProcess(command,args,options){
 return new Promise((resolveResult,reject)=>{
  const child=spawn(command,args,{cwd:options.cwd,env:options.env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',overflow=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},options.timeoutMs);
  const collect=key=>chunk=>{
   if(key==='stdout')stdout+=chunk;else stderr+=chunk;
   if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16*1024*1024){overflow=true;child.kill('SIGKILL');}
  };
  child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',(status,signal)=>{clearTimeout(timer);resolveResult({status,signal,stdout,stderr,timedOut,overflow});});
 });
}
async function regularFiles(root){
 const files=new Map();
 async function walk(dir){
  for(const name of await readdir(dir)){
   const path=join(dir,name),info=await lstat(path);
   if(info.isSymbolicLink())throw new Error('Installed package contains symlink');
   if(info.isDirectory())await walk(path);
   else if(info.isFile())files.set(relative(root,path).split(sep).join('/'),await readFile(path));
   else throw new Error('Installed package contains nonregular file');
  }
 }
 await walk(root);return files;
}
async function assertOptionalAbsent(root,names){
 // Check all installed dependency nesting, not just the top-level SDK location.
 async function walk(dir){
  for(const name of await readdir(dir)){
   const path=join(dir,name),info=await lstat(path);
   const normalized=path.split(sep).join('/');
   if(names.some(n=>normalized.endsWith('/node_modules/'+n)))throw new Error('Optional SDK installed: '+name);
   if(info.isDirectory())await walk(path);
  }
 }
 await walk(root);
}
export async function runInstalledJourney(input,{run=runProcess}={}){
 const {tarball,sha256,sourceSha,outputDirectory}=input;
 if(typeof tarball!=='string'||!tarball||typeof outputDirectory!=='string'||!outputDirectory||
    !/^[a-f0-9]{64}$/.test(sha256??'')||!/^[a-f0-9]{40}$/.test(sourceSha??''))throw new Error('Explicit tarball, sha256, source SHA and output directory required');
 const source=resolve(tarball),info=await lstat(source);
 if(!info.isFile()||info.isSymbolicLink())throw new Error('Archive must be a regular file');
 const bytes=await readFile(source);
 if(digest(bytes)!==sha256)throw new Error('Archive digest mismatch');
 // Validate the archive before install effects. Only this immutable byte copy is installed.
 const members=archiveFiles(bytes),pkg=JSON.parse(members.get('package.json')?.toString()??'null');
 if(pkg?.name!=='@tnunamak/gozar'||Object.keys(pkg.dependencies??{}).length)throw new Error('Archive must be standalone @tnunamak/gozar');
 for(const name of ['examples/remote-access-screen.mjs','examples/provider-lifecycle-fixture.mjs'])
  if(!members.has(name))throw new Error('Missing installed example '+name);
 const output=resolve(outputDirectory);await mkdir(output,{mode:0o700});
 const scratch=await mkdtemp(join(tmpdir(),'gzj-'));
 const report={status:'failed',tarball:source,sha256,sourceSha,sourceShaProvenance:'caller-supplied, not authenticated by archive',scratch,steps:[]};
 const save=()=>writeFile(join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 try{
  await mkdir(join(scratch,'home'),{mode:0o700});await mkdir(join(scratch,'cache'),{mode:0o700});
  const pinned=join(scratch,'artifact.tgz');await writeFile(pinned,bytes,{mode:0o600,flag:'wx'});
  await writeFile(join(scratch,'package.json'),JSON.stringify({private:true}),{mode:0o600});
  // Keep PATH only for npm/node discovery; no inherited npm options, NODE_PATH or NODE_OPTIONS.
  const env={PATH:process.env.PATH,HOME:join(scratch,'home'),TMPDIR:scratch,
   npm_config_cache:join(scratch,'cache'),npm_config_userconfig:join(scratch,'empty.npmrc'),
   npm_config_globalconfig:join(scratch,'empty-global.npmrc'),npm_config_offline:'true',
   npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
  await writeFile(env.npm_config_userconfig,'');await writeFile(env.npm_config_globalconfig,'');
  async function step(name,command,args){
   const result=await run(command,args,{cwd:scratch,env,timeoutMs:240000});
   report.steps.push({name,command,args,result});await save();
   await writeFile(join(output,name+'.stdout'),result.stdout??'',{mode:0o600});
   await writeFile(join(output,name+'.stderr'),result.stderr??'',{mode:0o600});
   if(result.status!==0||result.signal||result.timedOut||result.overflow){
    const error=new Error('Installed journey subprocess failed: '+name);error.result=result;throw error;
   }
   return result.stdout;
  }
  await step('install','npm',['install','--offline','--ignore-scripts','--omit=optional','--no-audit','--no-fund','--no-save','--package-lock=false',pinned]);
  const installed=join(scratch,'node_modules','@tnunamak','gozar');
  const actual=await regularFiles(installed);
  if(actual.size!==members.size||[...members].some(([name,body])=>!actual.get(name)?.equals(body)))throw new Error('Archive and installed bytes differ');
  await assertOptionalAbsent(join(scratch,'node_modules'),Object.keys(pkg.optionalDependencies??{}));
  report.members=[...members].map(([path,body])=>({path,sha256:digest(body),bytes:body.length}));
  report.optionalDependenciesAbsent=Object.keys(pkg.optionalDependencies??{});
  const screen=await step('screen',process.execPath,[join(installed,'examples/remote-access-screen.mjs'),'--fakes']);
  if(!screen.startsWith('Remote access\n')||!screen.includes('Host inputs:')||!screen.includes('Choice:'))throw new Error('Unknown screen outcome');
  const raw=await step('lifecycle',process.execPath,[join(installed,'examples/provider-lifecycle-fixture.mjs')]);
  const lifecycle=JSON.parse(raw);report.lifecycle=lifecycle;await save();
  if(lifecycle?.fixtureOnly!==true||typeof lifecycle.providerId!=='string'||!lifecycle.providerId.startsWith('fixture-')||
     lifecycle.proof?.status!=='verified'||lifecycle.cleanup?.state!=='confirmed'||
     lifecycle.resourceLedger?.foreignPreserved!==true||!Array.isArray(lifecycle.resourceLedger?.ownedAfter)||
     lifecycle.resourceLedger.ownedAfter.length!==0||lifecycle.statusPreservedProofTime!==true||
     !Array.isArray(lifecycle.events)||!lifecycle.events.includes('start')||!lifecycle.events.includes('proof'))
   throw new Error('Unknown or incomplete lifecycle outcome; cleanup debt retained');
  report.status='passed';await save();return report;
 }catch(error){
  report.failure={name:error.name,message:error.message,code:error.code??null,result:error.result??null};
  await save();throw error;
 }
 // Scratch intentionally remains for failure/debt inspection; never erase provider evidence.
}
function argumentsOf(argv){
 const names={'--tarball':'tarball','--sha256':'sha256','--source-sha':'sourceSha','--output-directory':'outputDirectory'},out={};
 for(let i=0;i<argv.length;i+=2){
  const name=names[argv[i]],value=argv[i+1];
  if(!name||!value||value.startsWith('--')||name in out)throw new Error('Unknown, repeated or missing argument');
  out[name]=value;
 }
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await runInstalledJourney(argumentsOf(process.argv.slice(2)));console.log(JSON.stringify(result));}
 catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
