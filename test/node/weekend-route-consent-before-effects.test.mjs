// Conservative canonical boundary only; these are not public zero-effect tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const repositoryRoot = new URL('../../', import.meta.url);
const {routeConsentReview,consentSnapshot,setupConsentReview} =
 await import(new URL('packages/gozar-node/consent-facts.mjs',repositoryRoot));
function offer(){
 return {registryId:randomUUID(),providerId:randomUUID(),usage:{kind:'session',lifetimeMs:60000},
  configuration:{scopeId:randomUUID(),revision:randomUUID()},target:'http://127.0.0.1:32100',
  origin:null,ownership:'gozar-owned',disclosure:{revision:'fixture-v1',text:'Fixture route',links:[]},
  properties:{reach:'this-device',transport:'http',
   traffic:{tlsTermination:'endpoint',providerCanReadPayload:false,readers:[],metadataVisibleTo:[],evidenceRef:null},
   address:{stability:'ephemeral',scope:'fixture',conditions:[],ports:null},
   cost:{kind:'paid',summary:'Metered fixture',currency:'USD',amount:1,period:'hour'},
   lifetimes:['session'],supervision:'controller',protocols:{sse:false,streamableHttp:false,oauthDcr:false}},
  facts:[{id:'scope',label:'Fixture scope',value:0,known:true,group:'Authority',source:'fixture',affectsConsent:true,asOf:null},
   {id:'other',label:'Other fixture',value:false,known:true,group:'Authority',source:'fixture',affectsConsent:true,asOf:null}]};
}
const digest=value=>routeConsentReview(value).consentFactsDigest;
test('regression: same-kind cost change must invalidate route consent without an auxiliary fact',()=>{
 const base=offer();
 for(const [field,value] of [['amount',2],['currency','EUR'],['period','minute'],['summary','Updated summary']]){
  const changed=structuredClone(base);changed.properties.cost[field]=value;
  assert.notEqual(digest(changed),digest(base),'unbound cost field: '+field);
 }
});
test('canonical boundary: fact order, timestamps and irrelevant facts preserve consent',()=>{
 const base=offer(),changed=structuredClone(base);
 changed.facts.reverse();for(const fact of changed.facts)fact.asOf='2030-01-01T00:00:00Z';
 changed.facts.push({id:'cosmetic',label:'Cosmetic',value:'changed',known:true,
  group:'Display',source:'fixture',affectsConsent:false,asOf:null});
 assert.equal(digest(changed),digest(base));
});
test('canonical boundary: zero false null and unknown cannot share authority',()=>{
 const base=offer(),digests=[];
 for(const [known,value,reason] of [[true,0,null],[true,false,null],[true,null,null],[false,null,'unobserved']]){
  const changed=structuredClone(base);Object.assign(changed.facts[0],{known,value,reason});
  digests.push(digest(changed));
 }
 assert.equal(new Set(digests).size,4);
});
test('canonical boundary: scoped route changes bind the digest',()=>{
 const base=offer();
 for(const mutate of [x=>x.target='http://127.0.0.1:32101',
  x=>x.origin='http://localhost:32102',x=>x.usage.lifetimeMs=120000,
  x=>x.registryId=randomUUID(),x=>x.configuration.scopeId=randomUUID(),
  x=>x.configuration.revision=randomUUID(),x=>x.properties.traffic.readers.push('new-reader'),
  x=>x.facts[0].value=1,x=>x.ownership='external-owned']){
  const changed=structuredClone(base);mutate(changed);
  assert.notEqual(digest(changed),digest(base));
 }
});

test('cost is bound exactly once as the entire visible disclosure',()=>{
 const data=offer();
 for(const cost of [{kind:'free',summary:'Included'}, {kind:'unknown',summary:'Ask the owner'},
  {...data.properties.cost,amount:0}]){
  data.properties.cost=cost;
  const review=routeConsentReview(data), snapshot=consentSnapshot(review);
  assert.equal(snapshot.consentFactsDigest,review.consentFactsDigest);
  assert.deepEqual(snapshot.disclosures.cost,cost);
  assert.deepEqual(snapshot.facts,data.facts.map(row=>({...row,reason:null})).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(review.canonicalInput.version,'consent-v1');
  assert.equal(review.canonicalJson.match(/"cost":/g).length,1);
 }
});
test('unit declared pricing rejects malformed values without coercion',()=>{
 for(const [field,value] of [['amount',NaN],['amount',Infinity],['amount',{}],
  ['amount','1'],['amount',false],['currency',42],['currency',{}],['period',false]]){
  const data=offer();data.properties.cost[field]=value;
  assert.throws(()=>routeConsentReview(data),{code:'invalid_input'});
 }
});
test('setup review retains its own action disclosure and facts',()=>{
 const data=offer();
 const review=setupConsentReview({registryId:data.registryId,providerId:data.providerId,
  configuration:data.configuration,action:{id:'fixture',digest:'fixture',kind:'instructions',
   label:'Fixture',disclosure:data.disclosure},facts:data.facts});
 const snapshot=consentSnapshot(review);
 assert.deepEqual(Object.keys(snapshot.disclosures),['action']);
 assert.deepEqual(snapshot.facts,data.facts.map(row=>({...row,reason:null})).sort((a,b)=>a.id.localeCompare(b.id)));
});
