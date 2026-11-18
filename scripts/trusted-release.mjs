#!/usr/bin/env node
// CI-only release orchestration. Importing this module has no effects.
import {readFile,writeFile,mkdir,readdir,lstat,realpath,copyFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareReleaseHandoff,finalizeReleaseHandoff} from './prepare-release-handoff.mjs';
import {runInstalledJourney,runProcess} from './release-installed-journey.mjs';

const NAME='@tnunamak/gozar', REPO='tnunamak/gozar';
const digest=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest(algorithm==='sha512'?'base64':'hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v,flag='w')=>writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag});
const fail=message=>{throw new Error(message);};
export function context(env){
 if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||
    env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'||
    env.GITHUB_REPOSITORY!==REPO||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')||
    env.GITHUB_WORKFLOW_REF!==REPO+'/.github/workflows/npm-publish.yml@refs/heads/main'||
    env.GITHUB_WORKFLOW_SHA!==env.GITHUB_SHA)fail('Unexpected CI source context');
 return env.GITHUB_SHA;
}
export function identity(pkg,other=pkg){
 const valid=p=>p?.name===NAME&&typeof p.version==='string'&&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(p.version)&&
  p.repository?.type==='git'&&p.repository.url==='https://github.com/'+REPO+'.git'&&
  p.publishConfig?.access==='public'&&(!p.publishConfig.registry||p.publishConfig.registry==='https://registry.npmjs.org/');
 if(!valid(pkg)||!valid(other)||pkg.name!==other.name||pkg.version!==other.version)
  fail('Package/version/repository mismatch');
 return pkg;
}
export function success(r){
 if(!r||r.status!==0||r.signal||r.error||r.timedOut||r.overflow||r.drainTimedOut||
    r.cleanup?.state!=='confirmed')fail('Subprocess unsuccessful or cleanup unconfirmed');
 return r;
}
export function nodeGate(result){
 success(result);const text=result.stdout??'',counts={};
 if(!text.startsWith('TAP version 13\n')||/^\s*(?:not ok\b|Bail out!)/m.test(text)||
    /^\s*(?:ok|not ok)\b.*#\s*(?:SKIP|TODO)\b/im.test(text))fail('Failed or skipped TAP');
 for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
  const rows=[...text.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];
  if(rows.length!==1)fail('Missing or repeated TAP summary');
  counts[key]=Number(rows[0][1]);
 }
 if(!Number.isSafeInteger(counts.pass)||counts.pass<=0||counts.tests!==counts.pass||
    ['fail','cancelled','skipped','todo'].some(k=>counts[k]!==0))fail('Contradictory TAP success');
 return {exitCode:result.status,failed:counts.fail,passed:counts.pass};
}
export function rustGate(result){
 success(result);
 const text=result.stdout??'',rows=[...text.matchAll(/^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/gm)];
 if(!rows.length||/test result: FAILED|^error:/m.test(text)||rows.some(r=>r.slice(2,6).some(n=>Number(n)!==0)))
  fail('Missing, failed or skipped Rust result');
 const passed=rows.reduce((n,r)=>n+Number(r[1]),0);
 if(!Number.isSafeInteger(passed)||passed<=0)fail('Empty Rust gate');
 return {exitCode:result.status,failed:0,passed};
}
export async function discoverTests(root){
 const files=[];
 async function walk(dir){
  for(const entry of await readdir(join(root,dir),{withFileTypes:true})){
   const path=join(dir,entry.name);
   if(entry.isSymbolicLink())fail('Symlink in test tree');
   if(entry.isDirectory())await walk(path);
   else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))files.push(path);
  }
 }
 await walk('test/node');await walk('test/adapters');
 if(!files.length)fail('No Node tests discovered');
 return files.sort();
}
function sameMembers(a,b){
 const normalize=rows=>Array.isArray(rows)?rows.map(m=>[m.path,m.bytes,m.sha256]).sort((x,y)=>x[0].localeCompare(y[0])):null;
 return Array.isArray(a)&&Array.isArray(b)&&JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}
export function consumerReceipt(report,manifest){
 if(report?.status!=='passed'||report.failure||report.sourceSha!==manifest.sourceSha||
    report.sha256!==manifest.sha256||report.tarball!==manifest.tarball||
    !sameMembers(report.members,manifest.members)||
    !Array.isArray(report.optionalDependenciesAbsent)||!report.optionalDependenciesAbsent.includes('@ngrok/ngrok')||
    !Array.isArray(report.steps)||report.steps.map(s=>s.name).join(',')!=='install,screen,lifecycle')
  fail('Incomplete installed archive evidence');
 for(const step of report.steps)success(step.result);
 const screen=report.steps[1].result.stdout,l=report.lifecycle;
 if(typeof screen!=='string'||!screen.startsWith('Remote access\n')||!screen.includes('Host inputs:')||!screen.includes('Choice:')||
    JSON.stringify(JSON.parse(report.steps[2].result.stdout))!==JSON.stringify(l)||
    l?.fixtureOnly!==true||!l.providerId?.startsWith('fixture-')||l.proof?.status!=='verified'||
    l.cleanup?.state!=='confirmed'||l.resourceLedger?.foreignPreserved!==true||
    !Array.isArray(l.resourceLedger.ownedAfter)||l.resourceLedger.ownedAfter.length||
    l.statusPreservedProofTime!==true||!Array.isArray(l.events)||
    !/^setup,start,proof(?:,proof)*,stop,cleanup$/.test(l.events.join(',')))fail('Unsuccessful installed journey');
 return {schemaVersion:1,kind:'gozar-installed-consumer',status:report.status,execution:'real-installed-archive',
  sourceSha:report.sourceSha,sha256:report.sha256,unresolvedFailures:[],
  absentOptionalPackages:report.optionalDependenciesAbsent,
  journeys:{screen:{exitCode:report.steps[1].result.status,installedBytes:true},
   lifecycle:{exitCode:report.steps[2].result.status,installedBytes:true}},
  proofVerified:l.proof.status==='verified',cleanupConfirmed:l.cleanup.state==='confirmed',
  foreignAppPreserved:l.resourceLedger.foreignPreserved,archiveMembersMatch:true};
}
function cleanEnv(env,online=false){
 const out={};
 for(const key of ['PATH','HOME','TMPDIR','CARGO_HOME','RUSTUP_HOME','RUSTUP_TOOLCHAIN','CARGO_TARGET_DIR','WASM_BINDGEN'])
  if(env[key])out[key]=env[key];
 Object.assign(out,{CARGO_NET_OFFLINE:'true',CARGO_BUILD_JOBS:'1',
  npm_config_offline:online?'false':'true',npm_config_audit:'false',npm_config_fund:'false',
  npm_config_userconfig:join(env.HOME,'empty.npmrc'),npm_config_globalconfig:join(env.HOME,'empty-global.npmrc'),
  npm_config_registry:'https://registry.npmjs.org/'});
 if(online)for(const [key,value] of Object.entries(env))
  if(key.startsWith('GITHUB_')||['CI','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN'].includes(key))out[key]=value;
 return out;
}
async function regular(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())fail('Expected regular evidence file');return readFile(path);}
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}fail('Unexpected preexisting path: '+path);}
function caller(root,env,run,logDirectory){
 let sequence=0;
 return async (command,args,extra={})=>{
  const result=await run(command,args,{cwd:root,env:cleanEnv(env),timeoutMs:1800000,...extra});
  // Deliberately omit environment from receipts: OIDC values must never be recorded.
  await save(join(logDirectory,'step-'+String(sequence++).padStart(3,'0')+'.json'),{command,args,result});
  success(result);return result;
 };
}
async function source(root,sha,call){
 if((await call('git',['rev-parse','HEAD'])).stdout.trim()!==sha||
    (await call('git',['status','--porcelain=v1','--untracked-files=all'])).stdout.trim())fail('Dirty or mismatched checkout');
 return identity(await json(join(root,'package.json')));
}
async function archiveIdentity(manifest,pkg,call){
 const bytes=await regular(manifest.tarball);
 if(digest(bytes)!==manifest.sha256||bytes.length!==manifest.archiveBytes)fail('Archive changed');
 const member=manifest.members.filter(m=>m.path==='package.json');
 if(member.length!==1)fail('Missing archive identity');
 // The existing handoff inventory has already refused unsafe/duplicate/nonregular tar members.
 const text=(await call('tar',['-xOzf',manifest.tarball,'package/package.json'])).stdout;
 if(digest(Buffer.from(text))!==member[0].sha256)fail('Archived package bytes differ');
 const archived=identity(pkg,JSON.parse(text));
 if(manifest.package.name!==archived.name||manifest.package.version!==archived.version)fail('Pack output identity mismatch');
 return bytes;
}
export async function qualify({root,outputDirectory,env=process.env},{run=runProcess}={}){
 const sha=context(env);root=await realpath(root);outputDirectory=resolve(outputDirectory);
 const rel=relative(root,outputDirectory);
 if(!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))fail('Evidence must be outside checkout');
 await mkdir(outputDirectory,{mode:0o700}); // Never reuse a prior attempt's directory.
 await mkdir(join(outputDirectory,'logs'),{mode:0o700});
 const call=caller(root,env,run,join(outputDirectory,'logs'));
 const pkg=await source(root,sha,call);
 await absent(join(root,'.npmrc'));
 if((await call(process.execPath,['--version'])).stdout.trim()!=='v22.16.0'||
    (await call('npm',['--version'])).stdout.trim()!=='11.15.0'||
    !(await call('rustc',['--version'])).stdout.startsWith('rustc 1.90.0 '))fail('Unexpected tool versions');
 await absent(env.CARGO_TARGET_DIR); // Workflow reserves a fresh, not-yet-created build path.
 await call('bash',['scripts/build-wasm.sh']);
 const tests=await discoverTests(root);
 const node=nodeGate(await call(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...tests]));
 const rust=rustGate(await call('cargo',['test','--workspace','--locked','--offline','--jobs','1','--','--test-threads=1']));
 await source(root,sha,call); // Also detects a lockfile update by the WASM build.
 const gateReceipt=join(outputDirectory,'gate.json');
 await save(gateReceipt,{schemaVersion:1,kind:'gozar-offline-host-gate',status:'passed',sourceSha:sha,node,rust});
 const packRun=async(c,a,o)=>call(c,a,{...o,env:cleanEnv(env)});
 const prepared=await prepareReleaseHandoff({root,sourceSha:sha,gateReceipt,outputDirectory:join(outputDirectory,'artifact')},{run:packRun});
 await archiveIdentity(prepared,pkg,call);
 const preparedPath=join(outputDirectory,'prepared.json');await save(preparedPath,prepared);
 const report=await runInstalledJourney({tarball:prepared.tarball,sha256:prepared.sha256,sourceSha:sha,outputDirectory:join(outputDirectory,'installed')},{run});
 const consumerPath=join(outputDirectory,'consumer.json');await save(consumerPath,consumerReceipt(report,prepared));
 const manifestPath=join(outputDirectory,'artifact','manifest.json');
 const manifest=await finalizeReleaseHandoff({manifestPath,consumerReceipt:consumerPath});
 const files=[preparedPath,manifestPath,gateReceipt,consumerPath,join(outputDirectory,'installed','result.json')];
 const hashes={};for(const path of files)hashes[path]=digest(await regular(path));
 await save(join(outputDirectory,'qualification.json'),{sourceSha:sha,root,manifestPath,preparedPath,hashes});
 return manifest;
}
export function publicationEnv(env){
 context(env);
 for(const [key,value] of Object.entries(env))
  if(value&&(/^(?:NPM_TOKEN|NODE_AUTH_TOKEN)$/i.test(key)||/^npm_config_.*(?:auth|token|password|userconfig|globalconfig|registry)/i.test(key)))
   fail('Unexpected npm credential/config environment');
 if(!env.ACTIONS_ID_TOKEN_REQUEST_URL?.startsWith('https://')||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)fail('OIDC unavailable');
 return cleanEnv(env,true);
}
async function registryVersion(pkg,{fetchImpl=fetch}={}){
 const response=await fetchImpl('https://registry.npmjs.org/'+encodeURIComponent(pkg.name)+'/'+encodeURIComponent(pkg.version),
  {redirect:'error',signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});
 if(response.status===404)return null;
 if(response.status!==200)fail('Registry lookup failed: '+response.status);
 const value=await response.json();
 if(value.name!==pkg.name||value.version!==pkg.version||typeof value.dist?.integrity!=='string')fail('Unknown registry response');
 return value.dist.integrity;
}
export async function pollIntegrity(pkg,expected,{fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=180000}={}){
 const deadline=now()+timeoutMs;
 while(now()<deadline){
  const found=await registryVersion(pkg,{fetchImpl});
  if(found!==null){if(found!==expected)fail('Registry integrity mismatch');return found;}
  const remaining=deadline-now();if(remaining<=0)break;
  await sleep(Math.min(5000,remaining));
 }
 fail('Registry visibility timeout; never republish automatically');
}
export async function publish({root,outputDirectory,env=process.env},{run=runProcess,fetchImpl=fetch,now=Date.now,sleep}={}){
 const pubEnv=publicationEnv(env),sha=context(env);root=await realpath(root);outputDirectory=resolve(outputDirectory);
 const q=await json(join(outputDirectory,'qualification.json'));
 if(q.sourceSha!==sha||q.root!==root)fail('Qualification source mismatch');
 await mkdir(join(outputDirectory,'publication'),{mode:0o700}); // Single attempt, even after ambiguous failure.
 const call=caller(root,env,run,join(outputDirectory,'publication'));
 const pkg=await source(root,sha,call);await absent(join(root,'.npmrc'));
 for(const [path,expected] of Object.entries(q.hashes??{}))
  if(digest(await regular(path))!==expected)fail('Qualification receipt changed');
 const prepared=await json(q.preparedPath),manifest=await json(q.manifestPath);
 const required=[q.preparedPath,q.manifestPath,prepared.gateReceipt,manifest.consumerReceipt,join(outputDirectory,'installed','result.json')];
 if(required.some(p=>!q.hashes[p])||manifest.status!=='qualified-artifact'||prepared.sourceSha!==sha)fail('Incomplete qualification');
 const raw=await json(join(outputDirectory,'installed','result.json'));
 if(JSON.stringify(consumerReceipt(raw,prepared))!==JSON.stringify(await json(manifest.consumerReceipt)))fail('Consumer translation changed');
 const validationPath=join(outputDirectory,'publication','revalidate.json');
 await copyFile(q.preparedPath,validationPath);
 const checked=await finalizeReleaseHandoff({manifestPath:validationPath,consumerReceipt:manifest.consumerReceipt});
 if(JSON.stringify(checked)!==JSON.stringify(manifest))fail('Qualified manifest changed');
 const bytes=await archiveIdentity(manifest,pkg,call);
 if(pkg.version==='0.5.0')fail('Version 0.5.0 already released; commit a new version');
 if(await registryVersion(pkg,{fetchImpl})!==null)fail('Version already exists');
 // Re-read immediately after network lookup; preserve exact qualified bytes, never pack again.
 for(const path of required)if(digest(await regular(path))!==q.hashes[path])fail('Evidence changed before publication');
 if(!(await regular(manifest.tarball)).equals(bytes))fail('Archive changed before publication');
 await save(join(outputDirectory,'publication','attempt.json'),{sourceSha:sha,sha256:manifest.sha256,version:pkg.version,status:'attempted'},'wx');
 await call('npm',['publish',manifest.tarball,'--access','public','--ignore-scripts','--registry=https://registry.npmjs.org/'],
  {env:pubEnv,timeoutMs:180000});
 const integrity=await pollIntegrity(pkg,'sha512-'+digest(bytes,'sha512'),{fetchImpl,now,sleep});
 const result={status:'published-and-integrity-verified',sourceSha:sha,sha256:manifest.sha256,integrity,version:pkg.version};
 await save(join(outputDirectory,'publication','result.json'),result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [mode,...extra]=process.argv.slice(2);
  if(extra.length||!['qualify','publish'].includes(mode))fail('Choose qualify or publish; paths come from CI environment');
  const input={root:process.env.GITHUB_WORKSPACE,outputDirectory:process.env.GOZAR_RELEASE_OUTPUT};
  console.log(JSON.stringify(await (mode==='qualify'?qualify(input):publish(input))));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
