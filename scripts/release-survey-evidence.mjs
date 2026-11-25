import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SURVEY_REVISION='ae83f3d71954d4220da77b80e62ddb0f859ef323';
export const CLARITY_REVISION='e27b326a7e29e08bba65bff9bcba02c7124f8845';
export const REQUIRED_REVIEWS=['r040-survey-primary-counts-1117','r040-survey-primary-profiles-1117','r040-survey-data-parity-1117'];
const PARITY_REVIEW='r040-survey-data-parity-1117';
const INVENTORY_DIGEST_BASIS='SHA-256 of UTF-8 JSON array of {path,bytes,sha256}, sorted by path; each file hash is over its original bytes.';
const CLARITY_BRANCH='dot/r040-manifest-coverage-clarity-1117';
const exec=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inventory=files=>Object.keys(files).sort().map(path=>({path,bytes:Buffer.byteLength(files[path]),sha256:hash(files[path])}));
const bytes=(snapshot,path)=>{
 if(!Object.hasOwn(snapshot.files,path))throw new Error('Unreadable required source: '+path);
 return Buffer.isBuffer(snapshot.files[path])?snapshot.files[path]:Buffer.from(snapshot.files[path],'utf8');
};
const text=(snapshot,path)=>bytes(snapshot,path).toString('utf8');
const data=(snapshot,path)=>JSON.parse(text(snapshot,path));
function providerPath(base,path){
 if(typeof path!=='string'||!path||posix.isAbsolute(path)||path.includes('\\'))throw new Error('Invalid provider path');
 const name=posix.normalize(posix.join(base,path));
 if(!name.startsWith('adapters/'))throw new Error('Provider path escapes adapters');
 return name;
}
export function assembleEvidence({surveyRevision,survey,candidate,clarity,receipts=[]}){
 if(surveyRevision!==SURVEY_REVISION||survey?.revision!==SURVEY_REVISION)
  throw new Error('Exact survey revision '+SURVEY_REVISION+' is required');
 if(!/^[a-f0-9]{40}$/.test(candidate?.revision??''))throw new Error('Candidate revision required');
 const manifest=data(candidate,'adapters/manifest.json');
 data(candidate,'runtime/adapter.schema.json');
 if(!Array.isArray(manifest.providers)||!manifest.providers.length)throw new Error('Provider inventory is missing');
 const seen=new Set();
 const entry=path=>({path,sha256:hash(bytes(candidate,path)),bytes:bytes(candidate,path).length});
 const providers=manifest.providers.map(provider=>{
  if(typeof provider.id!=='string'||!provider.id||seen.has(provider.id))throw new Error('Invalid/duplicate provider id');
  seen.add(provider.id);
  const definition=providerPath('adapters',provider.definition),module=providerPath('adapters',provider.module);
  const document=data(candidate,definition);
  if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('Provider definition must be an object');
  const wraps=[];
  let current=definition,value=document;const visited=new Set([definition]);
  while(value.wraps!==undefined){
   current=providerPath(posix.dirname(current),value.wraps);
   if(visited.has(current))throw new Error('Cyclic provider definition wrapping');
   visited.add(current);value=data(candidate,current);
   if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Wrapped definition must be an object');
   wraps.push(entry(current));
  }
  return {id:provider.id,module:entry(module),definition:entry(definition),wraps};
 });
 const normalized=(manifest.definitions??[]).map(path=>{
  const name=providerPath('adapters',path);data(candidate,name);return entry(name);
 });
 const coverageText=text(candidate,'docs/release-0.4-interface-coverage.md');
 const supplied=receipts.map(receipt=>({receipt,sha256:hash(JSON.stringify(receipt)),trust:'caller-supplied-review-receipt'}));
 const candidateFiles=inventory(candidate.files);
 const inventorySha256=hash(JSON.stringify(candidateFiles));
 const completed=REQUIRED_REVIEWS.filter(id=>receipts.some(r=>r?.id===id&&r.status==='completed'&&r.surveyRevision===SURVEY_REVISION&&
  (id!==PARITY_REVIEW||(r.candidateRevision===candidate.revision&&r.candidateInventorySha256===inventorySha256))));
 const missing=REQUIRED_REVIEWS.filter(id=>!completed.includes(id));
 return {
  schemaVersion:1,purpose:'one-shot-source-reconciliation',survey:{revision:survey.revision,files:inventory(survey.files)},
  candidate:{revision:candidate.revision,files:candidateFiles,inventorySha256,inventoryDigestBasis:INVENTORY_DIGEST_BASIS},providers,normalizedDefinitions:normalized,
  coverage:{path:'docs/release-0.4-interface-coverage.md',sha256:hash(bytes(candidate,'docs/release-0.4-interface-coverage.md')),text:coverageText,
   gapRows:coverageText.split('\n').filter(line=>/^\|/.test(line)&&!/^[| :\-]+$/.test(line)),
   missingBounds:['329','306','441','319','six','descriptor','posture'].filter(term=>!coverageText.toLowerCase().includes(term)),
   limitations:'Full document retained verbatim; table rows are evidence to review, not inferred semantic verdicts.'},
  clarity:{branch:CLARITY_BRANCH,...clarity},
  reviewPrerequisites:{required:REQUIRED_REVIEWS,completed,missing,receipts:supplied,
   note:'Caller receipts are retained provenance, not independently authenticated approvals. Queued work never counts as completed. Parity also requires the exact candidate revision and inventory hash.'},
  semanticCoverageClosed:false,saturationEstablished:false,hostAcceptance:'not-established',consumerAcceptance:'not-established',
  unresolved:[
   ...missing.map(id=>'Required completed survey review: '+id),
   ...(clarity?.incorporated===true?[]:['Qualified docs-only branch incorporation is not established']),
   'Human semantic reconciliation remains required, including 329/441 unknown-cell and 306/319 historical-source bounds, six non-tunnel postures, and incomplete descriptor/posture dimensions.',
   'Source hashes do not establish provider behavior, host acceptance, consumer acceptance, or survey saturation.',
  ],
 };
}
async function git(root,args){
 const {stdout}=await exec('git',['-C',root,'--no-pager',...args],{
  encoding:'buffer',maxBuffer:64*1024*1024,timeout:30000,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'},
 });
 return stdout;
}
async function snapshot(root,{git,realpath}){
 root=await realpath(root);
 const revision=(await git(root,['rev-parse','--verify','HEAD^{commit}'])).toString().trim();
 const tree=(await git(root,['ls-tree','-rz','--full-tree',revision])).toString().split('\0').filter(Boolean);
 const files={};let total=0;
 for(const row of tree){
  const match=/^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
  if(!match)throw new Error('Non-regular tracked entry cannot be inventoried: '+row);
  const bytes=await git(root,['cat-file','blob',match[2]]);
  total+=bytes.length;if(total>64*1024*1024)throw new Error('Source inventory exceeds explicit 64 MiB bound');
  files[match[3]]=bytes;
 }
 const workingTree=(await git(root,['status','--porcelain=v1','--untracked-files=no'])).toString();
 return {root,revision,files,workingTree};
}
// Optional transport is for hermetic source-observation tests; production uses real local Git and reads.
export async function collectEvidence({surveyRoot,candidateRoot,surveyRevision,reviewFiles=[]},{git:readGit=git,realpath:resolveRoot=realpath,readFile:readReceipt=readFile}={}){
 if(surveyRevision!==SURVEY_REVISION)throw new Error('Exact survey revision '+SURVEY_REVISION+' is required');
 if(!surveyRoot||!candidateRoot)throw new Error('Both local survey and candidate roots are required');
 const survey=await snapshot(surveyRoot,{git:readGit,realpath:resolveRoot});
 if(survey.revision!==surveyRevision)throw new Error('Local survey revision does not match requested survey revision');
 const candidate=await snapshot(candidateRoot,{git:readGit,realpath:resolveRoot});
 const clarity={incorporated:false,revision:CLARITY_REVISION,branchResolutions:[],
  reason:'Exact qualified commit unavailable or not incorporated'};
 // Mutable branch names are provenance only, never a qualification substitute.
 for(const ref of ['refs/heads/'+CLARITY_BRANCH,'refs/remotes/origin/'+CLARITY_BRANCH]){
  try{
   const revision=(await readGit(candidate.root,['rev-parse','--verify',ref+'^{commit}'])).toString().trim();
   clarity.branchResolutions.push({ref,revision});
  }catch{clarity.branchResolutions.push({ref,unavailable:true});}
 }
 try{
  const revision=(await readGit(candidate.root,['rev-parse','--verify',CLARITY_REVISION+'^{commit}'])).toString().trim();
  if(revision!==CLARITY_REVISION)throw new Error('Qualified commit resolution differs');
  await readGit(candidate.root,['merge-base','--is-ancestor',CLARITY_REVISION,candidate.revision]);
  clarity.incorporated=true;delete clarity.reason;
 }catch{/* Missing exact object or non-ancestry stays unresolved; never fetch. */}
 const receipts=[];
 for(const file of reviewFiles)receipts.push(JSON.parse(await readReceipt(file,'utf8')));
 const result=assembleEvidence({surveyRevision,survey,candidate,clarity,receipts});
 result.survey.localRoot=survey.root;result.survey.trackedWorkingTreeStatus=survey.workingTree;
 result.candidate.localRoot=candidate.root;result.candidate.trackedWorkingTreeStatus=candidate.workingTree;
 result.contentBasis='Committed HEAD blobs only; working-tree status is reported separately and is not hashed as candidate content.';
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options={reviewFiles:[]};
  const keys={'--survey-root':'surveyRoot','--candidate-root':'candidateRoot','--survey-revision':'surveyRevision'};
  const args=process.argv.slice(2);
  while(args.length){
   const flag=args.shift(),value=args.shift();
   if(!value||value.startsWith('--'))throw new Error('Missing argument value');
   if(flag==='--review-receipt')options.reviewFiles.push(value);
   else if(keys[flag]){if(options[keys[flag]])throw new Error('Duplicate argument');options[keys[flag]]=value;}
   else throw new Error('Unknown argument: '+flag);
  }
  process.stdout.write(JSON.stringify(await collectEvidence(options),null,2)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
