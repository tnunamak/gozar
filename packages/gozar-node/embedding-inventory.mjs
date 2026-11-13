import {inspectAdapter,readContextFor,catalogRevisionOf} from './route-catalog.mjs';
import {availabilityFor,prerequisitesFor,configurationFor} from './embedding-state.mjs';
import {capabilityPrerequisites} from './embedding-prerequisites.mjs';
import {embeddingError} from './embedding-services.mjs';
export async function listProviders(request,deps={}){
 if(!Array.isArray(deps.adapters))throw embeddingError('provider_unavailable');
 const platform=deps.platform??process.platform;const observedAt=new Date().toISOString();
 const read=await readContextFor(deps,request.home,platform);
 const inspections=await Promise.all(deps.adapters.map(a=>inspectAdapter(a,read,platform)));
 const providers=await Promise.all(inspections.map(async item=>{
  const {adapter,properties}=item;const actions=[...new Map([...item.actions,...(item.missingActions??[])].map(a=>[a.id,a])).values()];
  const saved=await deps.embeddingServices.readConfiguration({...request,providerId:adapter.id});
  const configuration={...configurationFor(actions,saved),revision:saved.revision,scopeId:saved.scopeId};
  configuration.inputRequirements=(adapter.definition.inputRequirements??configuration.inputRequirements).map(i=>({...i,actionId:i.actionId??i.id}));
  const prerequisites=[...prerequisitesFor(item,observedAt),...capabilityPrerequisites(adapter.definition,request.hostCapabilities??deps.hostCapabilities??{})];
  const availability=availabilityFor(adapter.definition);
  for(const kind of Object.keys(availability))if(availability[kind].state==='available'){
   const denied=prerequisites.find(p=>['denied','unsupported','unknown'].includes(p.state)&& (adapter.definition.requiredCapabilities??[]).includes(p.id));
   if(denied)availability[kind]={state:'unsupported',reason:`host-capability-${denied.state}`};
   else if(item.state!=='ready')availability[kind]={state:item.state,reason:`provider-${item.state}`};
  }
  return {providerId:adapter.id,label:adapter.definition.label??adapter.id,reach:properties.reach,transport:properties.transport,availability,prerequisites,configuration,facts:structuredClone(adapter.definition.facts??[])};
 }));
 return {schemaVersion:1,catalogRevision:catalogRevisionOf(inspections,platform),observedAt,providers};
}
