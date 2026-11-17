// Data rows may name a scalar in the adapter's existing read-only observations.
// A missing observation remains unknown; false, zero, empty and null are values.
export function catalogFactsFor({adapter,facts:observations}){
 return (adapter.definition.facts??[]).map(fact=>{
  if(!fact.source.startsWith('local-observation:'))return structuredClone(fact);
  const pointer=fact.source.slice('local-observation:'.length);
  let value=observations,found=pointer===''||pointer.startsWith('/');
  for(const segment of pointer===''?[]:pointer.slice(1).split('/')){
   const key=segment.replaceAll('~1','/').replaceAll('~0','~');
   if(!value||typeof value!=='object'||!Object.hasOwn(value,key)){found=false;break;}
   value=value[key];
  }
  if(found&&(value===null||['boolean','string'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))){const {reason,...row}=fact;return {...row,known:true,value};}
  return {...fact,known:false,value:null,reason:'local-observation-unavailable'};
 });
}
