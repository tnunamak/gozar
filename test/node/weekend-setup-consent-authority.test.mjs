// Conservative boundary: canonical setup review, not public capability redemption.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupConsentReview,consentSnapshot} from '../../packages/gozar-node/consent-facts.mjs';

const input=()=>({
 registryId:randomUUID(),providerId:randomUUID(),
 configuration:{scopeId:randomUUID(),revision:randomUUID()},draftId:randomUUID(),
 action:{id:randomUUID(),kind:'provide-value',label:'Configure endpoint',digest:randomUUID(),
  valueFormat:'https-origin',disclosure:{revision:randomUUID(),text:'Use this endpoint',links:[]}},
 facts:[{id:'boundary',label:'Payload access',group:'Privacy',source:'inspection',
  known:false,value:'must not appear as known',reason:'not observed',affectsConsent:true,asOf:null}],
});
test('conservative canonical setup snapshot preserves unknown reason, labels and distinct scope',()=>{
 const data=input(),review=setupConsentReview(data),shown=consentSnapshot(review);
 assert.deepEqual(Object.keys(shown).sort(),['consentFactsDigest','disclosures','facts','scope']);
 assert.equal(shown.scope.kind,'setup');
 assert.equal('query' in shown.scope,false);
 assert.equal(shown.scope.draftId,data.draftId);
 assert.equal(shown.scope.scopeId,data.configuration.scopeId);
 assert.equal(shown.consentFactsDigest,review.consentFactsDigest);
 assert.deepEqual(shown.disclosures,{action:data.action});
 assert.deepEqual(shown.facts,[{...data.facts[0],value:null}]);
 shown.disclosures.action.label='mutated host copy';
 assert.equal(review.canonicalInput.typedDisclosures.action.label,data.action.label);
});
test('conservative canonical setup authority changes for each bound dimension',()=>{
 const base=input(),digest=setupConsentReview(base).consentFactsDigest;
 const changes=[
  d=>d.registryId=randomUUID(),d=>d.providerId=randomUUID(),
  d=>d.configuration.scopeId=randomUUID(),d=>d.configuration.revision=randomUUID(),
  d=>d.draftId=null,d=>d.action.id=randomUUID(),d=>d.action.digest=randomUUID(),
  d=>d.action.disclosure.revision=randomUUID(),d=>d.action.disclosure.text='Changed disclosure',
  d=>d.action.valueFormat='text',d=>d.facts[0].reason='different unknown',
  d=>d.facts[0].label='Different label',d=>d.facts[0].group='Different group',
  d=>{d.facts[0].known=true;d.facts[0].value=true;},
 ];
 for(const change of changes){
  const data=structuredClone(base);change(data);
  assert.notEqual(setupConsentReview(data).consentFactsDigest,digest);
 }
});
test('conservative canonical draft review never inherits applied scope or facts',()=>{
 const applied=input(),draft=structuredClone(applied);applied.draftId=null;
 draft.configuration.revision=randomUUID();draft.facts[0].reason='draft-specific uncertainty';
 const appliedView=consentSnapshot(setupConsentReview(applied));
 const draftView=consentSnapshot(setupConsentReview(draft));
 assert.notEqual(draftView.consentFactsDigest,appliedView.consentFactsDigest);
 assert.equal(draftView.scope.draftId,draft.draftId);
 assert.equal(draftView.facts[0].reason,'draft-specific uncertainty');
 assert.equal(appliedView.facts[0].reason,'not observed');
});
test('conservative canonical controls reject ambiguous inputs without invoking getters',()=>{
 const data=input();let reads=0;
 Object.defineProperty(data.action,'bad',{enumerable:true,get(){reads++;return 'bad';}});
 assert.throws(()=>setupConsentReview(data),{code:'invalid_input'});
 assert.equal(reads,0);
 const duplicate=input();duplicate.facts.push({...duplicate.facts[0]});
 assert.throws(()=>setupConsentReview(duplicate),{code:'invalid_input'});
 const unknown=input();delete unknown.facts[0].reason;
 assert.throws(()=>setupConsentReview(unknown),{code:'invalid_input'});
 const ordered=input(),other=structuredClone(ordered);
 other.action=Object.fromEntries(Object.entries(other.action).reverse());
 assert.equal(setupConsentReview(ordered).consentFactsDigest,setupConsentReview(other).consentFactsDigest);
});
