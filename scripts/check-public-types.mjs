#!/usr/bin/env node
// Artifact gate: run AFTER packing/installing. Source-unit tests do not qualify declarations.
import {spawn} from 'node:child_process';
import {access,stat,realpath,readFile,readdir,mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseArgs(args){
 const values={};
 for(let i=0;i<args.length;i+=2){
  const key=args[i];
  if(!['--installed-root','--tsc'].includes(key)||values[key]!==undefined)throw new Error('Unknown or duplicate argument: '+key);
  if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+key);
  values[key]=args[i+1];
 }
 if(!values['--installed-root']||!values['--tsc'])throw new Error('Required: --installed-root ABS_INSTALL_PREFIX --tsc ABS_COMPILER');
 if(!isAbsolute(values['--installed-root'])||!isAbsolute(values['--tsc']))throw new Error('Both paths must be absolute');
 return {installedRoot:values['--installed-root'],tsc:values['--tsc']};
}
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);};
function typeTarget(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 if(typeof value.types==='string')return value.types;
 // Only conditions active for an ESM downstream importer.
 for(const key of ['import','node','default']){
  const target=typeTarget(value[key]);if(target)return target;
 }
 return null;
}
async function existing(path,label,directory=false){
 try {const info=await stat(path);if(directory?!info.isDirectory():!info.isFile())throw new Error('wrong kind');return await realpath(path);}
 catch(cause){throw new Error('Missing or invalid '+label+': '+path,{cause});}
}
// Compiler output is evidence, not a stream to buffer without limit.
export const OUTPUT_CAP_BYTES=1024*1024;
// Bound on waiting for pipes after the kill. Not a guarantee that any descendant is gone.
const DRAIN_MS=250;
// An installed package is plain files. Any link inside it, at any depth, can lead a declaration back to source.
async function assertNoOwnedLinks(directory,pkg){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isSymbolicLink())throw new Error('Source-linked installed package member: '+relative(pkg,path));
  if(entry.isDirectory())await assertNoOwnedLinks(path,pkg);
 }
}
// Returns a cancellation function. The child argument is for deterministic local witnesses.
const realDeadline=(fire,ms)=>{
 const timer=setTimeout(fire,ms);
 return ()=>clearTimeout(timer);
};
export async function checkPublicTypes({installedRoot,tsc,timeoutMs=30000,outputCapBytes=OUTPUT_CAP_BYTES},{scheduleDeadline=realDeadline}={}){
 if(!isAbsolute(installedRoot)||!isAbsolute(tsc))throw new Error('Both paths must be absolute');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw new Error('Invalid compiler timeout');
 if(!Number.isInteger(outputCapBytes)||outputCapBytes<=0)throw new Error('Invalid compiler output cap');
 const root=await existing(installedRoot,'installation',true);
 const compiler=await existing(tsc,'compiler');await access(compiler,constants.X_OK);
 const pkgPath=join(root,'node_modules','@tnunamak','gozar');
 const pkg=await existing(pkgPath,'installed package',true);
 if(pkg!==pkgPath)throw new Error('Installed package must be materialized, not source-linked');
 let manifest;
 try{manifest=JSON.parse(await readFile(join(pkg,'package.json'),'utf8'));}
 catch(cause){throw new Error('Invalid installed package manifest',{cause});}
 for(const name of ['.','./testing']){
  const target=typeTarget(manifest.exports?.[name]);
  if(!target||!target.startsWith('./'))throw new Error('Missing installed type export: '+name);
  const path=await existing(resolve(pkg,target),'installed type export '+name);
  if(!inside(pkg,path))throw new Error('Source-linked or escaping installed type export: '+name);
 }
 await assertNoOwnedLinks(pkg,pkg);
 let project;
 try{
  project=await mkdtemp(join(root,'.gozar-public-types-'));
  await writeFile(join(project,'package.json'),JSON.stringify({private:true,type:'module'}));
  await copyFile(new URL('../test/fixtures/release-public-api-consumer.ts',import.meta.url),join(project,'consumer.ts'));
  await writeFile(join(project,'tsconfig.json'),JSON.stringify({compilerOptions:{
   target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:false,types:[],
  },files:['consumer.ts']},null,2));
  return await new Promise((resolveResult,reject)=>{
   const chunks={stdout:[],stderr:[]};
   let kept=0,timedOut=false,overflow=false,spawnError,settled=false,exited=false,exitCode=null,exitSignal=null,cancelDeadline,drainTimer;
   const terminationErrors=[];
   const grouped=process.platform!=='win32';
   const child=spawn(compiler,['--project',join(project,'tsconfig.json'),'--pretty','false'],{cwd:project,detached:grouped,stdio:['ignore','pipe','pipe']});
   // Kill our own process group once; a failed group kill falls back to the child itself.
   let killed=false;
   const kill=()=>{
    if(killed)return;killed=true;
    try{
     if(grouped&&child.pid)process.kill(-child.pid,'SIGKILL');
     else if(!exited)child.kill('SIGKILL');
    }catch(error){
     if(error.code==='ESRCH')return;
     terminationErrors.push(error.message);
     if(!exited){try{child.kill('SIGKILL');}catch(fallback){terminationErrors.push(fallback.message);}}
    }
   };
   // Escaped descendants can keep the pipes open after the compiler is gone. Give them a short, single drain window.
   const startDrain=()=>{if(!drainTimer)drainTimer=setTimeout(()=>finish(true),DRAIN_MS);};
   const finish=(truncated=false)=>{
    if(settled)return;
    settled=true;cancelDeadline?.();clearTimeout(drainTimer);
    if(truncated){
     child.stdout.destroy();child.stderr.destroy();
     // This reader no longer owns the gate's lifetime. It does not assert the process or any descendant is gone.
     if(!exited)child.unref();
    }
    if(spawnError){reject(new Error('Compiler could not start: '+spawnError.message,{cause:spawnError}));return;}
    // Raw bytes are decoded once at the end, so a split multi-byte character cannot corrupt the text.
    const text=name=>new TextDecoder('utf-8').decode(Buffer.concat(chunks[name]));
    resolveResult({code:exitCode,signal:exitSignal,stdout:text('stdout'),stderr:text('stderr'),timedOut,overflow,
     outputTruncated:truncated,descendantCleanup:timedOut||overflow?'unverified':'not-requested',terminationErrors});
   };
   const keep=name=>data=>{
    if(overflow)return;
    const room=outputCapBytes-kept;
    if(data.length>room){
     overflow=true;
     // Cut at a character boundary: drop an incomplete trailing sequence rather than emit a broken one.
     let end=Math.max(room,0);
     while(end>0&&(data[end]&0xC0)===0x80)end--;
     if(end>0)chunks[name].push(data.subarray(0,end));
     kept+=end;
     kill();startDrain();
    }else{chunks[name].push(data);kept+=data.length;}
   };
   child.stdout.on('data',keep('stdout'));child.stderr.on('data',keep('stderr'));
   cancelDeadline=scheduleDeadline(()=>{timedOut=true;kill();startDrain();},timeoutMs,child);
   child.on('error',error=>{spawnError=error;if(!child.pid)finish();});
   // exit records compiler status; only close proves its pipes drained.
   child.on('exit',(code,signal)=>{exited=true;exitCode=code;exitSignal=signal;});
   child.on('close',(code,signal)=>{if(!exited){exitCode=code;exitSignal=signal;}finish();});
  });
 }finally{if(project)await rm(project,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=await checkPublicTypes(parseArgs(process.argv.slice(2)));
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  const note=result.outputTruncated?'; output drain was cut off':'';
  if(result.overflow){process.stderr.write('\nInstalled public type compiler output exceeded the cap and was stopped; descendant cleanup is unverified'+note+'\n');process.exitCode=125;}
  else if(result.timedOut){process.stderr.write('\nInstalled public type compiler timed out; descendant cleanup is unverified'+note+'\n');process.exitCode=124;}
  else if(result.code!==0){process.stderr.write('\nInstalled public type compilation failed (exit '+result.code+', signal '+result.signal+')\n');process.exitCode=result.code??1;}
  else process.stdout.write('Installed public consumer compiled. This is not archive/head provenance or release qualification.\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
