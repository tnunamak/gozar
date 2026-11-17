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
// An installed package is plain files. Any link inside it, at any depth, can lead a declaration back to source.
async function assertNoOwnedLinks(directory,pkg){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isSymbolicLink())throw new Error('Source-linked installed package member: '+relative(pkg,path));
  if(entry.isDirectory())await assertNoOwnedLinks(path,pkg);
 }
}
export async function checkPublicTypes({installedRoot,tsc,timeoutMs=30000,outputCapBytes=OUTPUT_CAP_BYTES}){
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
   let stdout='',stderr='',timedOut=false,overflow=false,spawnError;
   const grouped=process.platform!=='win32';
   const child=spawn(compiler,['--project',join(project,'tsconfig.json'),'--pretty','false'],{cwd:project,detached:grouped,stdio:['ignore','pipe','pipe']});
   const kill=()=>{
    // Own process group only: descendants must not retain compiler output pipes.
    if(grouped&&child.pid){
     try{process.kill(-child.pid,'SIGKILL');}
     catch(error){if(error.code!=='ESRCH')child.kill('SIGKILL');}
    }else child.kill('SIGKILL');
   };
   const keep=(text,chunk)=>{
    if(overflow)return text;
    const room=outputCapBytes-Buffer.byteLength(text);
    const next=Buffer.byteLength(chunk)>room?(overflow=true,kill(),Buffer.from(chunk).subarray(0,Math.max(room,0)).toString('utf8')):String(chunk);
    return text+next;
   };
   child.stdout.on('data',data=>{stdout=keep(stdout,data);});child.stderr.on('data',data=>{stderr=keep(stderr,data);});
   const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
   child.on('error',error=>{spawnError=error;});
   child.on('close',(code,signal)=>{
    clearTimeout(timer);
    if(spawnError){reject(new Error('Compiler could not start: '+spawnError.message,{cause:spawnError}));return;}
    resolveResult({code,signal,stdout,stderr,timedOut,overflow});
   });
  });
 }finally{if(project)await rm(project,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=await checkPublicTypes(parseArgs(process.argv.slice(2)));
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  if(result.overflow){process.stderr.write('\nInstalled public type compiler output exceeded the cap and was stopped\n');process.exitCode=125;}
  else if(result.timedOut){process.stderr.write('\nInstalled public type compiler timed out\n');process.exitCode=124;}
  else if(result.code!==0){process.stderr.write('\nInstalled public type compilation failed (exit '+result.code+', signal '+result.signal+')\n');process.exitCode=result.code??1;}
  else process.stdout.write('Installed public consumer compiled. This is not archive/head provenance or release qualification.\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
