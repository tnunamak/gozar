// One current redacted review for every route lifecycle. No token is minted here.
import {readContextFor,inspectAdapter} from './route-catalog.mjs';
import {completeProperties,checksFor} from './route-view.mjs';
import {routeConsentReview} from './consent-facts.mjs';
import {consentDisclosureRevision} from './adopt-disclosure.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';
export async function currentRouteReview(request,adapter,deps,{runtimeFacts}={}){
 const home=request.home;
 const configuration=await deps.embeddingServices.readConfiguration({home,owner:request.owner,providerId:adapter.id});
 const context={...await readContextFor(deps,home,deps.platform??process.platform,request.owner),origin:request.origin??null};
 const inspection=await inspectAdapter(adapter,context,deps.platform??process.platform);
 const declared=completeProperties(runtimeFacts?.properties??inspection.properties,adapter.definition,request.usage.kind);
 const properties={...declared,proof:{...declared.proof,checks:checksFor(declared.proof.checks,{sse:request.requirements?.protocols.includes('sse')})}};
 const facts=[...new Map([...catalogFactsFor(inspection),...(runtimeFacts?.facts??[])].map(fact=>[fact.id,fact])).values()];
 const disclosure={...adapter.definition.disclosure,revision:consentDisclosureRevision(adapter.definition,request.intent)};
 if(request.intent==='adopt')disclosure.text+=' Gozar takes over the existing rule and removes it when the route is released or stopped.';
 const review=routeConsentReview({registryId:deps.registryId,providerId:adapter.id,usage:request.usage,configuration,target:request.target,origin:request.origin,properties,disclosure,facts});
 return {review,configuration,context,facts,properties};
}
