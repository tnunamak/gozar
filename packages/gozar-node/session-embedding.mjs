// Host-owned authority for one operational controller incarnation. No secret bytes enter bootstrap.
import {randomBytes} from 'node:crypto';
import {loadAdapters} from './adapter-runtime.mjs';
import {registryIdentity} from './registry-identity.mjs';
import {connectEmbeddingBroker} from './embedding-broker.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {consentReview,consentSnapshot} from './consent-facts.mjs';
import {fixtureSpawn} from './fixture-spawn.mjs';
import {testingFetch} from './testing-network.mjs';
import {gozarError} from './error-normalizer.mjs';

export async function connectSessionEmbedding(config,{onLoss}){
 const saved=config.embedding;if(!saved)return null;
 if(await registryIdentity(saved.registry)!==saved.registryId)throw gozarError('artifact_integrity_failed','The controller registry content changed');
 let lost=false,blocked=false,approved=saved.consentReview,current,subject=null;
 const services=await connectEmbeddingBroker({descriptor:saved.resolver,identity:saved.identity,onLoss:()=>{lost=true;blocked=true;onLoss();}});
 const adapters=await loadAdapters(saved.registry),adapter=adapters.find(a=>a.id===config.adapterId);
 if(!adapter)throw gozarError('artifact_integrity_failed','The selected controller adapter is absent');
 const dispatch=async request=>{
  if(!(adapter.definition.effectOperations??[]).some(row=>row.kind===request.kind&&row.operation===request.operation))throw gozarError('unsupported','The adapter has not declared this fixture effect operation');
  return services.dispatchEffect(request);
 };
 const deps={embeddingServices:services,registryId:saved.registryId,platform:process.platform,...(saved.fixtureEffects?{dispatchEffect:dispatch}:{})};
 const refresh=async()=>{
  if(lost)throw gozarError('secret_backend_unavailable','The host resolver is unavailable; readiness withdrawn');
  current=await currentRouteReview(saved.request,adapter,deps);
  if(current.review.consentFactsDigest!==approved.consentFactsDigest)blocked=true;
  return current;
 };
 const check=async()=>{await refresh();if(blocked)throw gozarError('consent_mismatch','Runtime consent changed; review the current route');};
 const tokens=new Map();
 return {
  ...(saved.fixtureEffects?{spawnProcess:fixtureSpawn(dispatch),fixtureVerifier:gate=>({vantages:['public','tailnet','lan'],async verify({origin,vantage,authorization,requirements,signal}){
   if(requirements.streamableHttp||requirements.oauthDcr)throw gozarError('unsupported','This fixture executor has no application protocol proof');
   const checked=await gate.verify(origin,{sse:requirements.sse,signal,fetch:testingFetch(dispatch)}),observedAtMs=Date.now();
   return {probeReceipt:{nonceRef:authorization.nonceRef,verifierRef:authorization.verifierRef,origin,vantage,remote:true,observedAtMs,expiresAtMs:Math.min(authorization.expiresAtMs,observedAtMs+15000),tls:checked.tls,instanceMatched:checked.instanceMatched,sse:checked.sse,streamableHttp:false,oauthDcr:false},provenance:{kind:'explicit-fixture-effects'}};
  }})}:{}),
  check,
  beforeEffect:async effect=>{if(['create','start'].includes(effect.operation))await check();},
  async project(output){
   try{await refresh();}catch{blocked=true;}
   const receipt=output.validation?.probeReceipt;
   if(receipt&&output.snapshot.phase==='published-ready')subject={origin:receipt.origin,target:saved.request.target,instanceId:saved.identity.instanceId,bootId:saved.identity.bootId,handleGeneration:1};
   const consentChange=blocked?{reason:lost?'host-resolver-unavailable':'consent-facts-changed',nextAction:lost?null:'review-route-consent'}:null;
   return {...output,target:saved.request.target,owner:saved.request.owner,operationId:config.operationId??null,proofSubject:subject,fixtureEffects:saved.fixtureEffects===true,
    consentFactsDigest:current?.review.consentFactsDigest??approved.consentFactsDigest,...(consentChange?{consentChange}:{}),
    ...(blocked?{snapshot:{...output.snapshot,phase:output.snapshot.phase==='stopped'?'stopped':'degraded',published:null},validation:null}:{})};
  },
  async review(){
   blocked=true;await refresh();
   const scope={...current.review.canonicalInput.scope,reviewHandle:saved.handle.id,handleGeneration:saved.handle.generation};
   const review=consentReview({scope,typedDisclosures:current.review.canonicalInput.typedDisclosures,facts:current.facts});
   const snapshot={...consentSnapshot(review),subject,approvalToken:randomBytes(32).toString('base64url'),expiresAt:new Date(Date.now()+600000).toISOString()};
   tokens.set(snapshot.approvalToken,{snapshot,review:current.review});return snapshot;
  },
  async approve(command,reprove){
   const offered=tokens.get(command.approvalToken);tokens.delete(command.approvalToken);await refresh();
   if(!offered||lost||Date.parse(offered.snapshot.expiresAt)<=Date.now()||offered.snapshot.consentFactsDigest!==command.consentFactsDigest||offered.review.consentFactsDigest!==current.review.consentFactsDigest||JSON.stringify(offered.snapshot.subject)!==JSON.stringify(subject))throw gozarError('consent_mismatch','The runtime review changed; request a new review');
   approved=current.review;blocked=false;
   try{const output=await reprove();await check();if(output.snapshot.phase!=='published-ready')throw gozarError('verification_failed','The existing route did not pass fresh proof');return output;}catch(error){blocked=true;throw error;}
  },
  async release(){if(!lost)await services.releaseConfigurationUse({owner:saved.request.owner,providerId:adapter.id,handle:saved.handle});},
  close(){services.close();},
 };
}
