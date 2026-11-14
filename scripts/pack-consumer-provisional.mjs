// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
// Provisional artifact identity only. This never asserts consumer or release acceptance.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,lstat,realpath,readFile,writeFile,readdir,rename,rm,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
async function subprocess(command,args,{cwd}){
  try {
    const {stdout}=await exec(command,args,{cwd,encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024,
      env:{...process.env,npm_config_ignore_scripts:'false'}});
    return stdout;
  } catch {
    // Do not echo arbitrary lifecycle output or environment into a handoff.
    throw new Error(command+' failed; no provisional artifact accepted');
  }
}
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const within=(parent,path)=>{const rel=relative(parent,path);return rel===''||(!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&rel!=='..'&&!isAbsolute(rel));};
async function regular(path){
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Expected a regular artifact file');
  return readFile(path);
}
async function snapshot(run,cwd){
  const git=async(...args)=>(await run('git',args,{cwd})).trim();
  if(await realpath(await git('rev-parse','--show-toplevel'))!==cwd)throw new Error('Run at the committed source root');
  const sourceSha=await git('rev-parse','HEAD'),sourceTree=await git('rev-parse','HEAD^{tree}');
  if(!/^[a-f0-9]{40,64}$/.test(sourceSha)||! /^[a-f0-9]{40,64}$/.test(sourceTree))throw new Error('Invalid committed source identity');
  if(await git('status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none'))throw new Error('Source tree must be clean and committed');
  return {sourceSha,sourceTree};
}
export async function packConsumerProvisional({cwd=fileURLToPath(new URL('../',import.meta.url)),output,run=subprocess}={}){
  if(typeof output!=='string'||!output)throw new Error('--output DIR is required');
  cwd=await realpath(cwd);
  const before=await snapshot(run,cwd);
  const pkg=JSON.parse(await regular(join(cwd,'package.json')));
  if(pkg.scripts?.prepack!=='node scripts/check-package.mjs')throw new Error('Required ordinary prepack closure check is missing');
  const requested=resolve(output);
  if(within(cwd,requested))throw new Error('Output must be outside source tree');
  await mkdir(requested,{recursive:true,mode:0o700});
  const outputInfo=await lstat(requested);
  if(!outputInfo.isDirectory()||outputInfo.isSymbolicLink())throw new Error('Output must be a real directory');
  output=await realpath(requested);
  if(within(cwd,output))throw new Error('Output must resolve outside source tree');
  const name='gozar-provisional-'+before.sourceSha+'-'+before.sourceTree;
  const destination=join(output,name),lock=destination+'.lock';
  let staging,locked=false;
  try {
    // Cooperating invocations serialize publication for this exact source identity.
    await mkdir(lock,{mode:0o700});locked=true;
    staging=await mkdtemp(join(output,'.gozar-pack-'));
    await chmod(staging,0o700);
    const raw=await run('npm',['pack','--json','--ignore-scripts=false','--pack-destination',staging],{cwd});
    let packed;
    try{packed=JSON.parse(raw);}catch{throw new Error('Ambiguous npm pack output');}
    if(!Array.isArray(packed)||packed.length!==1)throw new Error('Ambiguous npm pack output');
    const item=packed[0],filename=item?.filename;
    if(typeof filename!=='string'||basename(filename)!==filename||!filename.endsWith('.tgz')||filename.includes('\\'))throw new Error('Invalid npm archive filename');
    const entries=await readdir(staging);
    if(entries.length!==1||entries[0]!==filename)throw new Error('Ambiguous or missing archive');
    const bytes=await regular(join(staging,filename));
    if(!bytes.length||typeof item.shasum!=='string'||digest(bytes,'sha1')!==item.shasum)throw new Error('Archive digest mismatch');
    if(item.integrity!==undefined){
      const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
      if(item.integrity!==integrity)throw new Error('Archive integrity mismatch');
    }
    const after=await snapshot(run,cwd);
    if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Source identity changed while packing');
    const archiveName=name+'.tgz',tarball=join(destination,archiveName),manifest=join(destination,'manifest.json');
    const record={...before,tarball,sha256:digest(bytes),ordinaryPrepack:true,consumerAcceptance:'PENDING',releaseGate:'NOT RUN'};
    const json=JSON.stringify(record,null,2)+'\n';
    await rename(join(staging,filename),join(staging,archiveName));
    await writeFile(join(staging,'manifest.json'),json,{flag:'wx',mode:0o444});
    await chmod(join(staging,archiveName),0o444);
    if(digest(await regular(join(staging,archiveName)))!==record.sha256)throw new Error('Staged digest mismatch');
    let existing;
    try{existing=await lstat(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){
      if(!existing.isDirectory()||existing.isSymbolicLink())throw new Error('Artifact conflict');
      const names=(await readdir(destination)).sort();
      if(JSON.stringify(names)!==JSON.stringify([archiveName,'manifest.json'].sort())||
        (await regular(manifest)).toString('utf8')!==json||
        digest(await regular(tarball))!==record.sha256)throw new Error('Artifact conflict; existing bundle is unchanged');
    }else{
      // Whole bundle becomes visible together, never a manifest pointing at an absent archive.
      await rename(staging,destination);staging=null;
    }
    if(digest(await regular(tarball))!==record.sha256)throw new Error('Published artifact digest mismatch');
    return {...record,manifest};
  }finally{
    if(staging)await rm(staging,{recursive:true,force:true});
    if(locked)await rm(lock,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--output')throw new Error('Usage: node scripts/pack-consumer-provisional.mjs --output DIR');
    console.log(JSON.stringify(await packConsumerProvisional({output:process.argv[3]}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
