#!/usr/bin/env node
// Artifact gate: run AFTER packing/installing. Source-unit tests do not qualify declarations.
import {spawn} from 'node:child_process';
import {access,stat,lstat,readdir,realpath,readFile,mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MAX_COMPILER_OUTPUT_BYTES=1024*1024;

// Only this installed package is inspected. Sibling dependencies and compiler libraries
// remain normal compiler inputs; this is materialization checking, not archive provenance.
async function materializedTree(directory){
 for(const entry of await readdir(directory)){
  const path=join(directory,entry),info=await lstat(path);
  if(info.isSymbolicLink())throw new Error('Source-linked installed package entry (symbolic link): '+path);
  if(info.isDirectory())await materializedTree(path);
 }
}

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
export async function checkPublicTypes({installedRoot,tsc,timeoutMs=30000}){
 if(!isAbsolute(installedRoot)||!isAbsolute(tsc))throw new Error('Both paths must be absolute');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw new Error('Invalid compiler timeout');
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
 await materializedTree(pkg);
 let project;
 try{
  project=await mkdtemp(join(root,'.gozar-public-types-'));
  await writeFile(join(project,'package.json'),JSON.stringify({private:true,type:'module'}));
  await copyFile(new URL('../test/fixtures/release-public-api-consumer.ts',import.meta.url),join(project,'consumer.ts'));
  await writeFile(join(project,'tsconfig.json'),JSON.stringify({compilerOptions:{
   target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:false,types:[],
  },files:['consumer.ts']},null,2));
  return await new Promise((resolveResult,reject)=>{
   const captured={stdout:[],stderr:[]};let retainedBytes=0,outputOverflow=false;
   let timedOut=false,spawnError,settled=false,terminating=false;
   let exitCode=null,exitSignal=null,exited=false,drainTimer,timer;
   const terminationErrors=[];
   const grouped=process.platform!=='win32';
   const child=spawn(compiler,['--project',join(project,'tsconfig.json'),'--pretty','false'],{cwd:project,detached:grouped,stdio:['ignore','pipe','pipe']});
   const capture=(stream,data)=>{
    if(settled||outputOverflow)return;
    const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
    const keep=Math.min(bytes.length,MAX_COMPILER_OUTPUT_BYTES-retainedBytes);
    if(keep){captured[stream].push(Buffer.from(bytes.subarray(0,keep)));retainedBytes+=keep;}
    if(keep<bytes.length){outputOverflow=true;terminate();}
   };
   child.stdout.on('data',data=>capture('stdout',data));child.stderr.on('data',data=>capture('stderr',data));
   const finish=(outputTruncated=false)=>{
    if(settled)return;
    settled=true;clearTimeout(timer);clearTimeout(drainTimer);
    outputTruncated=outputTruncated||outputOverflow;
    if(outputTruncated){
     child.stdout.destroy();child.stderr.destroy();
     // A failed kill must not give this child ownership of the gate's lifetime.
     // This does not assert that the process or arbitrary descendants are gone.
     if(!exited)child.unref();
    }
    if(spawnError){reject(new Error('Compiler could not start: '+spawnError.message,{cause:spawnError}));return;}
    // Decode complete captured byte sequences once, never individual pipe chunks.
    // On overflow, omit an incomplete trailing code point at the truncation boundary.
    const decode=chunks=>new TextDecoder('utf-8',{ignoreBOM:true}).decode(Buffer.concat(chunks),{stream:outputOverflow});
    const stdout=decode(captured.stdout),stderr=decode(captured.stderr);
    resolveResult({code:outputOverflow&&exitCode===0?1:exitCode,signal:exitSignal,stdout,stderr,timedOut,outputTruncated,outputOverflow,
     descendantCleanup:terminating?'unverified':'not-requested',terminationErrors});
   };
   const terminate=()=>{
    if(terminating||settled)return;
    terminating=true;
    // Terminate our group, but escaped descendants may still own output pipes.
    // Independently bound draining those pipes instead of waiting for close forever.
    drainTimer=setTimeout(()=>finish(true),250);
    try{
     if(grouped&&child.pid)process.kill(-child.pid,'SIGKILL');
     else if(!exited)child.kill('SIGKILL');
    }catch(error){
     if(error.code!=='ESRCH'){
      terminationErrors.push(error.message);
      if(!exited){
       try{child.kill('SIGKILL');}catch(fallback){terminationErrors.push(fallback.message);}
      }
     }
    }
   };
   timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
   child.on('error',error=>{spawnError=error;});
   // exit records compiler status; only close proves its pipes have drained.
   child.on('exit',(code,signal)=>{exited=true;exitCode=code;exitSignal=signal;});
   child.on('close',(code,signal)=>{
    if(!exited){exitCode=code;exitSignal=signal;}
    finish();
   });
  });
 }finally{if(project)await rm(project,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=await checkPublicTypes(parseArgs(process.argv.slice(2)));
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  if(result.timedOut){process.stderr.write('\nInstalled public type compiler timed out; descendant cleanup is unverified'+(result.outputTruncated?'; output drain was truncated':'')+'\n');process.exitCode=124;}
  else if(result.outputOverflow){process.stderr.write('\nCompiler output exceeded the shared raw-byte limit; descendant cleanup is unverified\n');process.exitCode=1;}
  else if(result.code!==0){process.stderr.write('\nInstalled public type compilation failed (exit '+result.code+', signal '+result.signal+')\n');process.exitCode=result.code??1;}
  else process.stdout.write('Installed public consumer compiled. This is not archive/head provenance or release qualification.\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
