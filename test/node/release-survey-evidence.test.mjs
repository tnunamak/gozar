import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleEvidence,collectEvidence,CLARITY_REVISION,SURVEY_REVISION,REQUIRED_REVIEWS} from '../../scripts/release-survey-evidence.mjs';

// Tiny owned in-memory source snapshots. They are not real survey/release attestations.
function fixture(){
 const candidate={revision:'c'.repeat(40),files:{
  'docs/release-0.4-interface-coverage.md':'Survey '+SURVEY_REVISION+'\n329 unknown cells of 441 cells; 306 historical issue openers from 319 listed sources; six non-tunnel postures. Incomplete descriptor and posture dimensions.\n| topic | mapping | gap |\n| --- | --- | --- |\n| quota | facts | unknown account limit |',
  'adapters/manifest.json':JSON.stringify({providers:[{id:'custom',module:'providers/custom/index.mjs',definition:'providers/custom/definition.json'}],definitions:['custom.definition.json']}),
  'runtime/adapter.schema.json':JSON.stringify({$defs:{AdapterDefinition:{type:'object'}}}),
  'adapters/providers/custom/index.mjs':'export default {};',
  'adapters/providers/custom/definition.json':JSON.stringify({adapter:{id:'custom'},wraps:'../../custom.definition.json'}),
  'adapters/custom.definition.json':JSON.stringify({definition:{id:'custom'}}),
 }};
 const survey={revision:SURVEY_REVISION,files:{'round4/evidence.md':'unknown cells remain'}};
 return {surveyRevision:SURVEY_REVISION,survey,candidate,clarity:{incorporated:false},receipts:[]};
}
test('provenance inventories exact source bytes, retains unknowns and never grants semantic PASS',()=>{
 const input=fixture(),result=assembleEvidence(input);
 assert.equal(result.survey.revision,SURVEY_REVISION);
 assert.equal(result.providers.length,1);
 assert.equal(result.providers[0].definition.path,'adapters/providers/custom/definition.json');
 assert.match(result.survey.files[0].sha256,/^[a-f0-9]{64}$/);
 assert.match(result.coverage.text,/441.*319/);
 assert.ok(result.coverage.gapRows.some(row=>row.includes('unknown account')));
 assert.equal(result.semanticCoverageClosed,false);
 assert.equal(result.saturationEstablished,false);
 assert.deepEqual(result.reviewPrerequisites.missing,REQUIRED_REVIEWS);
 assert.equal(result.clarity.incorporated,false);
 const changed=fixture();changed.survey.files['round4/evidence.md']+=' changed';
 assert.notEqual(assembleEvidence(changed).survey.files[0].sha256,result.survey.files[0].sha256);
});
test('missing/wrong requested or actual survey revision is rejected',()=>{
 for(const revision of [undefined,'','a'.repeat(40)]){
  const input=fixture();input.surveyRevision=revision;
  assert.throws(()=>assembleEvidence(input),/survey revision/);
 }
 const input=fixture();input.survey.revision='b'.repeat(40);
 assert.throws(()=>assembleEvidence(input),/survey revision/);
});
test('unreadable, malformed and escaping provider definitions fail rather than disappear',()=>{
 for(const mode of ['missing','json','escape']){
  const input=fixture();
  if(mode==='missing')delete input.candidate.files['adapters/providers/custom/definition.json'];
  if(mode==='json')input.candidate.files['adapters/providers/custom/definition.json']='{';
  if(mode==='escape')input.candidate.files['adapters/manifest.json']=JSON.stringify({providers:[{id:'custom',module:'../../outside',definition:'../../outside'}]});
  assert.throws(()=>assembleEvidence(input));
 }
});
test('queued or wrong-revision receipts do not satisfy completed reviews',()=>{
 const input=fixture();
 input.receipts=REQUIRED_REVIEWS.map(id=>({id,status:'queued',surveyRevision:SURVEY_REVISION}));
 assert.deepEqual(assembleEvidence(input).reviewPrerequisites.missing,REQUIRED_REVIEWS);
 input.receipts=REQUIRED_REVIEWS.map(id=>({id,status:'completed',surveyRevision:'f'.repeat(40)}));
 assert.deepEqual(assembleEvidence(input).reviewPrerequisites.missing,REQUIRED_REVIEWS);
 const candidateInventorySha256=assembleEvidence(input).candidate.inventorySha256;
 input.receipts=REQUIRED_REVIEWS.map(id=>({id,status:'completed',surveyRevision:SURVEY_REVISION,candidateRevision:input.candidate.revision,candidateInventorySha256}));
 input.clarity={incorporated:true,revision:'d'.repeat(40)};
 const result=assembleEvidence(input);
 assert.deepEqual(result.reviewPrerequisites.missing,[]);
 assert.equal(result.semanticCoverageClosed,false);
 assert.equal(result.hostAcceptance,'not-established');
 assert.equal(result.consumerAcceptance,'not-established');
});
test('parity receipts must qualify the exact candidate revision and raw inventory',()=>{
 const baseline=fixture();
 const candidate=assembleEvidence(baseline).candidate;
 const expected=createHash('sha256').update(JSON.stringify(candidate.files)).digest('hex');
 assert.equal(candidate.inventorySha256,expected);
 assert.match(candidate.inventoryDigestBasis,/sorted by path/);
 const id=REQUIRED_REVIEWS.find(id=>id.includes('data-parity'));
 const receipt={id,status:'completed',surveyRevision:SURVEY_REVISION,candidateRevision:baseline.candidate.revision,candidateInventorySha256:expected};
 const parity=input=>assembleEvidence({...input,receipts:[receipt]}).reviewPrerequisites.completed;
 assert.deepEqual(parity(baseline),[id]);
 const stale=fixture();stale.candidate.revision='d'.repeat(40);
 assert.deepEqual(parity(stale),[]);
 const changed=fixture();changed.candidate.files['adapters/providers/custom/index.mjs']+='\n';
 assert.deepEqual(parity(changed),[]);
 const reordered=fixture();reordered.candidate.files=Object.fromEntries(Object.entries(reordered.candidate.files).reverse());
 assert.deepEqual(parity(reordered),[id]);
 assert.equal(assembleEvidence(reordered).candidate.inventorySha256,expected);
});

test('missing bounded denominator language remains an explicit documentation gap',()=>{
 const input=fixture();input.candidate.files['docs/release-0.4-interface-coverage.md']='329 unknown; 306 historical; six';
 const result=assembleEvidence(input);
 assert.ok(result.coverage.missingBounds.includes('441'));
 assert.ok(result.coverage.missingBounds.includes('319'));
 assert.equal(result.semanticCoverageClosed,false);
});

test('binary module entry and inventory hash the identical original bytes',()=>{
 const input=fixture(),path='adapters/providers/custom/index.mjs',bytes=Buffer.from([0x65,0xff,0x0a]);
 input.candidate.files[path]=bytes;
 const result=assembleEvidence(input),entry=result.providers[0].module;
 assert.deepEqual(entry,result.candidate.files.find(item=>item.path===path));
 assert.equal(entry.bytes,bytes.length);
 assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));
});

// Hermetic transport observations only: these do not attest to any real Git repository.
function collectorTransport({exactPresent=true,exactAncestor=false,local='a'.repeat(40),remote='b'.repeat(40)}={}){
 const input=fixture(),calls=[],blobs=new Map(),trees=new Map();
 for(const [root,source] of [['/survey',input.survey],['/candidate',input.candidate]]){
  trees.set(root,Object.entries(source.files).map(([path,body])=>{
   const oid=(blobs.size+1).toString(16).padStart(40,'0');
   blobs.set(oid,Buffer.from(body));return '100644 blob '+oid+'\t'+path+'\0';
  }).join(''));
 }
 const transport={
  realpath:async root=>root,
  readFile:async()=>{throw new Error('Unexpected receipt read');},
  git:async(root,args)=>{
   calls.push({root,args});
   if(args[0]==='rev-parse'){
    const ref=args[2];
    if(ref==='HEAD^{commit}')return Buffer.from(root==='/survey'?SURVEY_REVISION:input.candidate.revision);
    if(ref===CLARITY_REVISION+'^{commit}'){
     if(!exactPresent)throw new Error('missing exact object');
     return Buffer.from(CLARITY_REVISION);
    }
    if(ref.startsWith('refs/heads/'))return Buffer.from(local);
    if(ref.startsWith('refs/remotes/origin/'))return Buffer.from(remote);
   }
   if(args[0]==='ls-tree')return Buffer.from(trees.get(root));
   if(args[0]==='cat-file')return blobs.get(args[2]);
   if(args[0]==='status')return Buffer.from(' M tracked-file\n');
   if(args[0]==='merge-base'){
    // Both mutable refs are ancestors, even when the qualified commit is not.
    if(args[2]!==CLARITY_REVISION||exactAncestor)return Buffer.alloc(0);
    throw new Error('exact commit is not an ancestor');
   }
   throw new Error('Unexpected Git invocation '+JSON.stringify(args));
  },
 };
 return {transport,calls};
}
test('collector rejects wrong/stale same-name ancestor refs as qualification',async()=>{
 assert.equal(CLARITY_REVISION,'e27b326a7e29e08bba65bff9bcba02c7124f8845');
 for(const exactPresent of [true,false]){
  const {transport,calls}=collectorTransport({exactPresent});
  const result=await collectEvidence({surveyRoot:'/survey',candidateRoot:'/candidate',surveyRevision:SURVEY_REVISION},transport);
  assert.equal(result.clarity.incorporated,false);
  assert.ok(result.unresolved.some(item=>item.includes('incorporation')));
  assert.equal(result.semanticCoverageClosed,false);
  assert.equal(result.saturationEstablished,false);
  assert.ok(calls.filter(c=>c.args[0]==='merge-base').every(c=>c.args[2]===CLARITY_REVISION));
 }
});
test('collector qualifies exact commit ancestry despite stale local branch provenance',async()=>{
 const {transport,calls}=collectorTransport({exactAncestor:true,remote:CLARITY_REVISION});
 const result=await collectEvidence({surveyRoot:'/survey',candidateRoot:'/candidate',surveyRevision:SURVEY_REVISION},transport);
 assert.equal(result.clarity.incorporated,true);
 assert.equal(result.clarity.revision,CLARITY_REVISION);
 assert.ok(calls.some(c=>c.args[0]==='merge-base'&&c.args[2]===CLARITY_REVISION&&c.args[3]==='c'.repeat(40)));
 assert.deepEqual(result.clarity.branchResolutions.map(item=>item.revision),['a'.repeat(40),CLARITY_REVISION]);
 assert.equal(result.candidate.trackedWorkingTreeStatus,' M tracked-file\n');
 assert.match(result.contentBasis,/Committed HEAD blobs only/);
 assert.equal(result.semanticCoverageClosed,false);
 assert.equal(result.saturationEstablished,false);
});
