import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleEvidence,SURVEY_REVISION,REQUIRED_REVIEWS} from '../../scripts/release-survey-evidence.mjs';

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
 input.receipts=REQUIRED_REVIEWS.map(id=>({id,status:'completed',surveyRevision:SURVEY_REVISION}));
 input.clarity={incorporated:true,revision:'d'.repeat(40)};
 const result=assembleEvidence(input);
 assert.deepEqual(result.reviewPrerequisites.missing,[]);
 assert.equal(result.semanticCoverageClosed,false);
 assert.equal(result.hostAcceptance,'not-established');
 assert.equal(result.consumerAcceptance,'not-established');
});
test('missing bounded denominator language remains an explicit documentation gap',()=>{
 const input=fixture();input.candidate.files['docs/release-0.4-interface-coverage.md']='329 unknown; 306 historical; six';
 const result=assembleEvidence(input);
 assert.ok(result.coverage.missingBounds.includes('441'));
 assert.ok(result.coverage.missingBounds.includes('319'));
 assert.equal(result.semanticCoverageClosed,false);
});
