import test from 'node:test';
import assert from 'node:assert/strict';
import { consentReview } from '../../packages/gozar-node/consent-facts.mjs';

const fact = (id,value,extra={}) => ({id,label:id,value,known:true,group:'access',affectsConsent:true,source:'fixture',asOf:null,...extra});
const review = facts => consentReview({scope:{registryId:'r',providerId:'p',usage:'attached',configurationRevision:'c',target:'tcp://127.0.0.1:1',expectedOrigin:null},typedDisclosures:{reach:'internet',cost:{kind:'unknown'}},facts});
test('consent-v1 has a stable published canonical input and golden digest',()=>{
 const result=review([fact('z',false),fact('a',0)]);
 assert.equal(result.canonicalJson,'{"facts":[{"affectsConsent":true,"group":"access","id":"a","known":true,"label":"a","reason":null,"source":"fixture","value":0},{"affectsConsent":true,"group":"access","id":"z","known":true,"label":"z","reason":null,"source":"fixture","value":false}],"scope":{"configurationRevision":"c","expectedOrigin":null,"providerId":"p","registryId":"r","target":"tcp://127.0.0.1:1","usage":"attached"},"typedDisclosures":{"cost":{"kind":"unknown"},"reach":"internet"},"version":"consent-v1"}');
 assert.equal(result.consentFactsDigest,'consent-v1:9918d98fec80b81498331eece70c5d0dceceb0cbdd2269ebf07d90fc770f8c88');
});
test('false, zero, empty, null and unknown retain different consent meanings',()=>{
 const values=[false,0,'',null].map(v=>review([fact('a',v)]).consentFactsDigest);
 values.push(review([fact('a',null,{known:false,reason:'needs-provider-call'})]).consentFactsDigest);
 assert.equal(new Set(values).size,5);
});
test('row order and observation time do not change approval; consent edits do',()=>{
 const original=[fact('a',false),fact('b','')], digest=review(original).consentFactsDigest;
 assert.equal(review([...original].reverse().map(f=>({...f,asOf:'2099-01-01T00:00:00Z'}))).consentFactsDigest,digest);
 assert.equal(review([...original,fact('display','first',{affectsConsent:false})]).consentFactsDigest,digest);
 for(const changed of [[fact('a',true),original[1]],[original[0]], [...original,fact('c',0)],[{...original[0],affectsConsent:false},original[1]]])assert.notEqual(review(changed).consentFactsDigest,digest);
});
test('ambiguous values and duplicate IDs fail before an approval can be issued',()=>{
 for(const rows of [[fact('a',0),fact('a',1)], [fact('a',NaN)], [fact('a',undefined)], [fact('a',{})],[fact('a',null,{known:false})]])assert.throws(()=>review(rows),{code:'invalid_input'});
 assert.throws(()=>consentReview({scope:{ambiguous:undefined},typedDisclosures:{},facts:[]}),{code:'invalid_input'});
});
