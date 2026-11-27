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
// These bounds apply after termination begins, even when inherited pipes never close.
const PROCESS_DRAIN_MS=1000,PROCESS_KILL_GRACE_MS=200,PROCESS_OUTPUT_BYTES=16*1024*1024;
// The raw capture is shared, but malformed UTF-8 can expand when decoded.
function decodeDiagnosticStreams(chunks){
 let room=PROCESS_OUTPUT_BYTES;
 const decode=parts=>{
  if(!room)return '';
  const decoder=new TextDecoder('utf-8',{ignoreBOM:true});
  const kept=[];
  const retain=text=>{
   const bytes=Buffer.byteLength(text);
   if(bytes<=room){if(text)kept.push(text);room-=bytes;return room>0;}
   let end=0;
   for(const character of text){
    const length=Buffer.byteLength(character);
    if(length>room)break;
    room-=length;end+=character.length;
   }
   if(end)kept.push(text.slice(0,end));
   return false;
  };
  // Bound transient decoded segments without splitting valid UTF-8 across chunks.
  for(const part of parts)for(let offset=0;offset<part.length;offset+=16384){
   if(!retain(decoder.decode(part.subarray(offset,offset+16384),{stream:true})))return kept.join('');
  }
  retain(decoder.decode());
  return kept.join('');
 };
 return {stdout:decode(chunks.stdout),stderr:decode(chunks.stderr)};
}
export function runProcess(command,args,options,{spawnProcess=spawn}={}){
 return new Promise(resolveResult=>{
  let child;
  try{
   child=spawnProcess(command,args,{cwd:options.cwd,env:options.env,stdio:['ignore','pipe','pipe'],
    detached:process.platform!=='win32'});
  }catch(error){
   resolveResult({status:null,signal:null,stdout:'',stderr:'',timedOut:false,overflow:false,
    error:{name:error.name,message:error.message,code:error.code??null},
    cleanup:{scope:'not-started',state:'confirmed'}});return;
  }
  const group=process.platform!=='win32'&&Number.isInteger(child.pid)&&child.pid>0?child.pid:null;
  const chunks={stdout:[],stderr:[]},cleanupErrors=[];
  let retainedBytes=0,observedBytes=0,overflow=false,timedOut=false,processError=null;
  let status=null,signal=null,closed=false,settled=false,stopping=false,observedGroupGone=false;
  let timer,drainTimer,killTimer,pollTimer;
  const errorRecord=error=>({name:error.name,message:error.message,code:error.code??null});
  function groupGone(){
   if(group===null)return closed;
   if(observedGroupGone)return true;
   try{process.kill(-group,0);return false;}
   catch(error){
    if(error.code==='ESRCH'){observedGroupGone=true;return true;}
    if(!cleanupErrors.some(item=>item.code===error.code))cleanupErrors.push(errorRecord(error));
    return false;
   }
  }
  function sendSignal(name){
   try{
    // The negative id is only the isolated group created for this exact spawn.
    if(group!==null){if(!groupGone())process.kill(-group,name);}
    else if(!closed)child.kill(name);
   }catch(error){if(error.code!=='ESRCH')cleanupErrors.push(errorRecord(error));}
  }
  function finish(forced=false){
   if(settled)return;
   const gone=groupGone();
   if(!forced&&(!closed||!gone))return;
   settled=true;
   clearTimeout(timer);clearTimeout(drainTimer);clearTimeout(killTimer);clearInterval(pollTimer);
   if(!closed){child.stdout?.destroy?.();child.stderr?.destroy?.();child.unref?.();}
   resolveResult({status,signal,...decodeDiagnosticStreams(chunks),timedOut,overflow,drainTimedOut:!closed,
    outputBytes:retainedBytes,observedBytes,
    cleanup:{scope:group!==null?'process-group':'child-only',pid:child.pid??null,groupId:group,
     state:closed&&gone&&!(stopping&&group===null&&child.pid)?'confirmed':'unconfirmed',
     // A process group cannot prove anything about descendants that detach themselves.
     boundary:group!==null?'owned group only; escaped descendants not verified':'direct child only; descendants not verified',
     errors:cleanupErrors},
    ...(processError?{error:processError}:{})});
  }
  function stop(){
   if(stopping||settled)return;
   stopping=true;sendSignal('SIGTERM');
   killTimer=setTimeout(()=>{sendSignal('SIGKILL');finish();},PROCESS_KILL_GRACE_MS);
   drainTimer=setTimeout(()=>finish(true),PROCESS_DRAIN_MS);
   pollTimer=setInterval(()=>finish(),25);
  }
  const collect=key=>chunk=>{
   if(settled)return;
   const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
   observedBytes=Math.min(Number.MAX_SAFE_INTEGER,observedBytes+bytes.length);
   const take=Math.min(bytes.length,PROCESS_OUTPUT_BYTES-retainedBytes);
   if(take){chunks[key].push(Buffer.from(bytes.subarray(0,take)));retainedBytes+=take;}
   // Decode each stream only once after capture, so multibyte code points may span chunks.
   if(bytes.length>take){overflow=true;stop();}
  };
  child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
  // Error still permits trailing data up to close, but cannot leave settlement unbounded.
  child.once('error',error=>{processError=errorRecord(error);stop();});
  child.once('close',(code,why)=>{
   closed=true;status=code;signal=why;
   if(groupGone())finish();
   else{
    processError??={name:'Error',message:'Owned process group remains after child close',code:'PROCESS_DESCENDANTS_REMAIN'};
    stop();
   }
  });
  timer=setTimeout(()=>{timedOut=true;stop();},options.timeoutMs);
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
export function optionalPackageNames(pkg){
 return [...new Set([...Object.keys(pkg.optionalDependencies??{}),
  ...Object.keys(pkg.peerDependencies??{}).filter(name=>pkg.peerDependenciesMeta?.[name]?.optional===true)])];
}

export function installedStepFailed(result){
 return !result||!!(result.error||result.status!==0||result.signal||result.timedOut||result.overflow||
  result.drainTimedOut||result.cleanup?.state==='unconfirmed');
}

export function completeFixtureLifecycle(lifecycle){
 return lifecycle?.fixtureOnly===true&&typeof lifecycle.providerId==='string'&&lifecycle.providerId.startsWith('fixture-')&&
  lifecycle.proof?.status==='verified'&&lifecycle.cleanup?.state==='confirmed'&&
  lifecycle.resourceLedger?.foreignPreserved===true&&Array.isArray(lifecycle.resourceLedger?.ownedAfter)&&
  lifecycle.resourceLedger.ownedAfter.length===0&&lifecycle.statusPreservedProofTime===true&&
  Array.isArray(lifecycle.events)&&lifecycle.events.every(event=>['setup','start','proof','stop','cleanup'].includes(event))&&
  /^setup,start,proof(?:,proof)*,stop,cleanup$/.test(lifecycle.events.join(','));
}

export async function runInstalledJourney(input,{run=runProcess}={}){
 const {tarball,sha256,sourceSha,outputDirectory}=input;
 if(typeof tarball!=='string'||!tarball||typeof outputDirectory!=='string'||!outputDirectory||
    typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||
    typeof sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(sourceSha))throw new Error('Explicit tarball, sha256, source SHA and output directory required');
 const source=resolve(tarball),info=await lstat(source);
 if(!info.isFile()||info.isSymbolicLink())throw new Error('Archive must be a regular file');
 const bytes=await readFile(source);
 if(digest(bytes)!==sha256)throw new Error('Archive digest mismatch');
 // Validate the archive before install effects. Only this immutable byte copy is installed.
 const members=archiveFiles(bytes),pkg=JSON.parse(members.get('package.json')?.toString()??'null');
 if(pkg?.name!=='@tnunamak/gozar'||Object.keys(pkg.dependencies??{}).length)throw new Error('Archive must be standalone @tnunamak/gozar');
 for(const name of ['examples/remote-access-screen.mjs','examples/provider-lifecycle-fixture.mjs'])
  if(!members.has(name))throw new Error('Missing installed example '+name);
 const optionalNames=optionalPackageNames(pkg);
 const output=resolve(outputDirectory);await mkdir(output,{mode:0o700});
 const scratch=await mkdtemp(join(tmpdir(),'gzj-'));
 const report={schemaVersion:1,kind:'gozar-installed-consumer',execution:run===runProcess?'real-installed-archive':'injected-process-runner',status:'failed',tarball:source,sha256,sourceSha,sourceShaProvenance:'caller-supplied, not authenticated by archive',scratch,steps:[]};
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
   if(installedStepFailed(result)){
    const error=new Error('Installed journey subprocess failed: '+name);error.result=result;throw error;
   }
   return result.stdout;
  }
  await step('install','npm',['install','--offline','--ignore-scripts','--omit=optional','--no-audit','--no-fund','--no-save','--package-lock=false',pinned]);
  const installed=join(scratch,'node_modules','@tnunamak','gozar');
  const actual=await regularFiles(installed);
  if(actual.size!==members.size||[...members].some(([name,body])=>!actual.get(name)?.equals(body)))throw new Error('Archive and installed bytes differ');
  report.installedBytes=true;
  await assertOptionalAbsent(join(scratch,'node_modules'),optionalNames);
  report.members=[...members].map(([path,body])=>({path,sha256:digest(body),bytes:body.length}));
  report.optionalDependenciesAbsent=optionalNames;
  const screen=await step('screen',process.execPath,[join(installed,'examples/remote-access-screen.mjs'),'--fakes']);
  if(!screen.startsWith('Remote access\n')||!screen.includes('Host inputs:')||!screen.includes('Choice:'))throw new Error('Unknown screen outcome');
  const raw=await step('lifecycle',process.execPath,[join(installed,'examples/provider-lifecycle-fixture.mjs')]);
  const lifecycle=JSON.parse(raw);report.lifecycle=lifecycle;await save();
  if(!completeFixtureLifecycle(lifecycle))throw new Error('Unknown or incomplete lifecycle outcome; cleanup debt retained');
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
