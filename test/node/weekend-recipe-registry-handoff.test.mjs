// Authoring-only regression: run on the owner host, never against a real relay.
// Fixture definitions copied exactly from consumer-complete-contracts-1114.md;
// only registry identity/labels change. Positive output honors the declared parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,lstat,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {loadAdapters,sessionRecipeFor,validateSessionRecipe} from '../../packages/gozar-node/adapter-runtime.mjs';
import {launch,serve} from '../../packages/gozar-node/daemon.mjs';
import {createTestingGozar} from '../../packages/gozar-node/testing.mjs';
const declaredAdapter={"wraps":"../../tunnl-gg.definition.json","adapter":{"schemaVersion":1,"id":"tunnl-gg","label":"tunnl.gg trial","needs":"Needs the ssh command on this computer and outbound internet access. No account is needed.","capabilities":{"reach":"internet","transport":"https","traffic":{"tlsTermination":"provider","providerCanReadPayload":true,"readers":["tunnl.gg relay"],"metadataVisibleTo":["tunnl.gg relay"],"evidenceRef":"https://tunnl.gg (accessed 2026-11-12) ; https://tunnl.gg/terms.md (accessed 2026-11-12) ; https://tunnl.gg/privacy.md (accessed 2026-11-12)"},"address":{"stability":"stable","scope":"address bound to an installation key","conditions":["an announced address change ends the route","the relay can close quiet streams after about two minutes","browsers can show a warning page"],"ports":null},"cost":{"kind":"free","summary":"The free tier costs nothing and needs no account; Pro is $6 a month or $60 a year and removes time limits and the warning page.","currency":"USD","amount":0,"period":null},"needsAccount":false,"lifetimes":["session"],"supervision":"controller","protocols":{"sse":true,"streamableHttp":true,"oauthDcr":true},"proof":{"vantage":"public","checks":["tls","nonce","sse"]}},"supportedKinds":["session"],"disclosure":{"revision":"disc-6d909da5b275","text":"Start a public HTTPS trial through the tunnl.gg relay. The relay terminates TLS and can read payloads. Quiet streams can close after two minutes.","links":[{"rel":"terms","label":"Terms","href":"https://tunnl.gg/terms.md"},{"rel":"privacy","label":"Privacy","href":"https://tunnl.gg/privacy.md"}]},"ownership":"gozar-owned","availability":{"session":{"state":"detect-only","reason":"execution-not-implemented"},"attached":{"state":"unsupported","reason":"usage-not-supported"},"durable":{"state":"unsupported","reason":"usage-not-supported"}},"prerequisites":[{"id":"local-setup","label":"Local prerequisites","observation":"detected"}],"facts":[{"id":"cost-detail","label":"Cost details","value":"The free tier costs nothing and needs no account; Pro is $6 a month or $60 a year and removes time limits and the warning page.","known":true,"group":"cost","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"entitlement","label":"Account entitlement","value":null,"known":false,"reason":"needs-provider-call","group":"account","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"quota","label":"Remaining quota","value":null,"known":false,"reason":"needs-provider-call","group":"limits","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"mapping","label":"Effective provider mapping","value":null,"known":false,"reason":"needs-provider-call","group":"configuration","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"terms-terms","label":"Terms","value":"https://tunnl.gg/terms.md","known":true,"group":"terms","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"terms-privacy","label":"Privacy","value":"https://tunnl.gg/privacy.md","known":true,"group":"terms","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"address-condition-0","label":"Address condition","value":"an announced address change ends the route","known":true,"group":"address","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"address-condition-1","label":"Address condition","value":"the relay can close quiet streams after about two minutes","known":true,"group":"address","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"address-condition-2","label":"Address condition","value":"browsers can show a warning page","known":true,"group":"address","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"public-names","label":"Public names","value":null,"known":false,"reason":"not-observed","group":"privacy","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"certificate-logs","label":"Certificate logs","value":null,"known":false,"reason":"not-observed","group":"privacy","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"browser-warning","label":"Browser warning","value":null,"known":false,"reason":"not-observed","group":"access","affectsConsent":false,"source":"https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md","asOf":"2026-11-12"},{"id":"payload-readers","label":"Payload readers","value":"The tunnl.gg relay can read the traffic.","known":true,"group":"privacy","affectsConsent":true,"source":"https://tunnl.gg (accessed 2026-11-12) ; https://tunnl.gg/terms.md (accessed 2026-11-12) ; https://tunnl.gg/privacy.md (accessed 2026-11-12)","asOf":"2026-11-12"},{"id":"provider-clocks","label":"Actual provider expiry and quota window","value":null,"known":false,"reason":"needs-provider-call","group":"limits","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"provider-retry","label":"Current provider retry-after or refusal","value":null,"known":false,"reason":"needs-provider-call","group":"limits","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"diagnostics-access","label":"Current account diagnostic access","value":null,"known":false,"reason":"needs-provider-call","group":"account","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"credential-validity","label":"Current credential validity","value":null,"known":false,"reason":"needs-provider-call","group":"account","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"traffic-policy","label":"Effective remote traffic policy","value":null,"known":false,"reason":"needs-provider-call","group":"access","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"certificate-renewal","label":"Current CA issuance or renewal outcome","value":null,"known":false,"reason":"needs-provider-call","group":"privacy","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"dns-authority","label":"Current DNS configuration and token grants","value":null,"known":false,"reason":"needs-provider-call","group":"configuration","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"authoritative-address","label":"Current authoritative provider domain","value":null,"known":false,"reason":"needs-provider-call","group":"address","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"account-authorization","label":"Current organization approval and ACL entitlement","value":null,"known":false,"reason":"needs-provider-call","group":"access","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"remote-residue","label":"Remote DNS, certificate and token residue","value":null,"known":false,"reason":"needs-provider-call","group":"ownership","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"alternative-cost","label":"Account-specific alternative cost and quota","value":null,"known":false,"reason":"needs-provider-call","group":"cost","affectsConsent":false,"source":"https://tunnl.gg","asOf":"2026-11-12"},{"id":"proof-scope","label":"Proof scope","value":"Route transport and current Gozar boundary only; application login, authorization and downstream journeys are host-owned.","known":true,"group":"proof","affectsConsent":false,"source":"adapter-definition","asOf":"2026-11-13"},{"id":"storage-policy","label":"Credential storage","value":"The configured host credential backend owns custody; the default uses private local files. Read-back returns presence and non-secret values only.","known":true,"group":"setup","affectsConsent":false,"source":"adapter-definition","asOf":"2026-11-13"},{"id":"change-policy","label":"Configuration changes","value":"Saved inputs do not silently reconfigure a running route; stop and obtain fresh consent before replacing it.","known":true,"group":"configuration","affectsConsent":false,"source":"adapter-definition","asOf":"2026-11-13"},{"id":"fallback-policy","label":"Fallback policy","value":"Never substitute a different provider without consent.","known":true,"group":"access","affectsConsent":false,"source":"adapter-definition","asOf":"2026-11-13"},{"id":"remote-termination","label":"Effective remote TLS termination","value":null,"known":false,"reason":"needs-provider-call","group":"privacy","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-logging","label":"Account-selected logging and retention","value":null,"known":false,"reason":"needs-provider-call","group":"privacy","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-name-ownership","label":"Current reserved name ownership","value":null,"known":false,"reason":"needs-provider-call","group":"address","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-setup-completion","label":"Provider consent or remote setup completion","value":null,"known":false,"reason":"needs-provider-call","group":"setup","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"provider-status","label":"Current provider dashboard status","value":null,"known":false,"reason":"needs-provider-call","group":"runtime","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"browser-warning-applicability","label":"Account-specific browser warning applicability","value":null,"known":false,"reason":"needs-provider-call","group":"access","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-collision","label":"Current remote endpoint collision","value":null,"known":false,"reason":"needs-provider-call","group":"address","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"revocation-state","label":"Actual credential revocation and remaining connectors","value":null,"known":false,"reason":"needs-provider-call","group":"ownership","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-control-authority","label":"Current remote binding and controller authority","value":null,"known":false,"reason":"needs-provider-call","group":"ownership","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"provider-depletion","label":"Current provider depletion or license expiry","value":null,"known":false,"reason":"needs-provider-call","group":"limits","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-domain-options","label":"Account reserved-domain choices","value":null,"known":false,"reason":"needs-provider-call","group":"setup","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"account-domain-suggestion","label":"Current account-assigned suggested domain","value":null,"known":false,"reason":"needs-provider-call","group":"setup","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-issuance","label":"Provider credential issuance or refresh outcome","value":null,"known":false,"reason":"needs-provider-call","group":"setup","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-job-completion","label":"Provider provisioning job completion","value":null,"known":false,"reason":"needs-provider-call","group":"setup","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-identity","label":"Authenticated remote account or tunnel identity","value":null,"known":false,"reason":"needs-provider-call","group":"account","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-rotation","label":"Remote credential rotation outcome","value":null,"known":false,"reason":"needs-provider-call","group":"ownership","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"remote-deletion-proof","label":"Remote revocation and deletion proof","value":null,"known":false,"reason":"needs-provider-call","group":"ownership","affectsConsent":false,"source":"gozar:catalog:no-provider-call","asOf":null},{"id":"retained-configuration","label":"Retained configuration","value":"Stopping a route keeps saved input values and credentials. Local rotation does not revoke a credential at the provider.","known":true,"group":"ownership","affectsConsent":false,"source":"adapter-configuration","asOf":"2026-11-13"}],"effectOperations":[{"kind":"recipe","operation":"probe"},{"kind":"spawn","operation":"run"},{"kind":"spawn","operation":"read"},{"kind":"spawn","operation":"close"},{"kind":"network","operation":"fetch"}]},"evidence":{"accessed":"2026-11-12","sources":["https://tunnl.gg","https://tunnl.gg/terms.md","https://tunnl.gg/privacy.md"],"protocols":{"sse/streamableHttp":"true. Backed by validation.sse (timed incremental event delivery when required) and validation.publish (exact-origin approval only after all required probes) in the wrapped recipe definition, with admission.requiredFeatures probe-assertions and client-vantage-probe.","oauthDcr":"oauthDcr: the stable user gives 'a URL tied to your SSH key that stays the same across reconnects' (https://tunnl.gg); Gozar preserves the configured authority. The wrapped recipe's addressStability 'random' conflicts with this page and is reported as an open question."}}};
const declaredRecipe={"schemaVersion":1,"definition":{"endpointLifetime":"owned-process","id":"tunnl-gg","label":"tunnl.gg stable trial","audience":"public","ownership":"owned","reason":"Key-bound public trial; the relay terminates TLS and can read payloads.","capabilities":{"https":null,"sse":null,"streamableHttp":null,"oauthDcr":null},"unknowns":["The relay can close quiet streams after about two minutes.","Browser users can encounter a warning page.","Trust-on-first-use applies only to isolated known_hosts; changed key fails closed.","The address is bound to an installation key; an announced address change withdraws the route."],"capabilityRecords":[{"when":"validated relay origin + TLS/nonce probe","capabilities":{"https":true}},{"when":"timed stream/client probes pass","capabilities":{"sse":true,"streamableHttp":true,"oauthDcr":true}}],"actions":[{"id":"ssh-install","label":"Install OpenSSH","reason":"OpenSSH client is absent."},{"id":"trial-consent","label":"Start a public trial","reason":"The relay sees plaintext; a changed address ends the route."}],"recipes":{"detect":{"kind":"spawn","program":"ssh","args":["-V"],"timeoutMs":5000,"maxOutputBytes":65536,"parser":{"kind":"contains","stream":"combined","value":"OpenSSH"}},"create":{"kind":"spawn","program":"ssh","args":["-F","/dev/null","-T","-o","BatchMode=yes","-o","ExitOnForwardFailure=yes","-o","ConnectTimeout=10","-o","ServerAliveInterval=15","-o","ServerAliveCountMax=2","-o","StrictHostKeyChecking=accept-new","-o","UserKnownHostsFile={privateKnownHostsPath}","-o","GlobalKnownHostsFile=/dev/null","-o","IdentityAgent=none","-o","IdentityFile={installIdentityPath}","-o","ForwardAgent=no","-o","IdentitiesOnly=yes","-o","PasswordAuthentication=no","-o","KbdInteractiveAuthentication=no","-o","PermitLocalCommand=no","-R","80:127.0.0.1:{gatePort}","stable@proxy.tunnl.gg","output=json"],"timeoutMs":30000,"maxOutputBytes":65536,"parser":{"kind":"url","prefix":"https://","constraints":{"hostnamePattern":"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.tunnl\\.gg$","exactOriginToken":true,"stripAnsi":true,"rejectMultipleDistinct":true},"jsonEvent":{"eventPointer":"/event","eventValue":"tunnel","originPointer":"/url"}},"before":[],"requires":[{"op":"private-file","binding":"privateKnownHostsPath","mode":"0600","parentMode":"0700"},{"op":"private-file","binding":"installIdentityPath","mode":"0600","parentMode":"0700"}],"process":{"mode":"owned-long-running","stdin":"closed","lifetimeMs":900000},"after":[],"ledger":{"service":"trial","durationMs":900000}},"remove":{"kind":"owned-process","signal":"SIGTERM","graceMs":2000,"thenSignal":"SIGKILL","confirmExit":true,"timeoutMs":5000,"maxOutputBytes":16384,"parser":{"kind":"exit-code"},"before":[],"requires":[],"after":[]}},"admission":{"state":"admitted","requiredFeatures":["recipe-sequence","typed-bindings","predicate-parser","owned-resource-ledger","probe-assertions","client-vantage-probe","owned-process","private-file-reference","install-ed25519","json-event-origin","immutable-origin"],"reason":"Opt-in stable address, private installation identity and public relay probe required."},"validation":{"tls":"client-trusted certificate and exact hostname when HTTPS","instanceNonce":"must equal private instance challenge","sse":"timed incremental event delivery when required","vantage":"public","publish":"exact-origin approval only after all required probes"},"lifecycle":{"persistIntentBeforeMutation":true,"completionScope":["effectId","sessionId","generation"],"rawOutput":"transient bounded; never persist","stop":"withdraw before cleanup; reconcile uncertain effects","globalCleanup":false,"durationMs":900000,"artifactCleanup":"Only after confirmed owned process exit; handle identity checked by driver."},"bindings":{"gatePort":{"type":"loopback-port"},"privateKnownHostsPath":{"type":"session-private-path"},"installIdentityPath":{"type":"session-private-path","provision":"install-ed25519"}},"planVersion":1,"clientProfile":{"id":"initial-streaming","clientRequirements":{"httpsRequired":true,"sse":true}},"displayName":"tunnl.gg stable trial","drop":"1a","copy":{"consent":"Start a public HTTPS trial. The relay terminates TLS and can read payloads. Quiet streams can close after two minutes.","human":{"name":"tunnl.gg","address":"assigned when it starts","summary":"key-based trial; relay can read traffic","setup":"Install OpenSSH"}},"originPolicy":"immutable","addressStability":"random","durableLifetime":null,"idleTimeoutMs":121000}};
const runtimeURL=new URL('../../packages/gozar-node/adapter-runtime.mjs',import.meta.url).href;
const executable=fileURLToPath(new URL('../../bin/gozar.mjs',import.meta.url));
const HOST_LIFETIME_MS=20000,OPERATION_MS=25000,CLEANUP_MS=7000;
async function bounded(label,operation,ms=CLEANUP_MS) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(label+' timed out; outcome unconfirmed')),ms);
  })]);} finally {clearTimeout(timer);}
}
const exited=child=>child.exitCode!==null||child.signalCode!==null;
async function waitReaped(child,label) {
  if(!exited(child))await bounded(label,()=>once(child,'exit'),3000);
  assert.ok(exited(child),label+': child exit not observed');
}
async function endpointUnavailable(port) {
  assert.ok(Number.isInteger(port)&&port>0,'allocated gate port required');
  await new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:'/'},res=>{
      res.resume();reject(new Error('gate still answers after public cleanup'));
    });
    req.setTimeout(1500,()=>req.destroy(new Error('gate absence unconfirmed: timeout')));
    req.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
  });
}
async function resolverUnavailable(path) {
  await new Promise((resolve,reject)=>{
    const socket=net.createConnection(path);
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('resolver absence unconfirmed: timeout'));},1500);
    socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('resolver still listening after cleanup'));});
    socket.once('error',error=>{clearTimeout(timer);socket.destroy();['ENOENT','ECONNREFUSED'].includes(error.code)?resolve():reject(error);});
  });
}
async function fixture(t) {
  const temporary=join(homedir(),'.tmp');
  await mkdir(temporary,{recursive:true,mode:0o700});
  const stat=await lstat(temporary);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  assert.equal(stat.mode&0o777,0o700,'fixture parent must already be trusted');
  const root=await mkdtemp(join(temporary,'gr-'));
  const cleanups=[];let retainEvidence=false;
  // Node reports this hook's errors alongside any original body failure.
  t.after(async()=>{const errors=[];
    for(const [index,cleanup] of [...cleanups].reverse().entries())
      try{await bounded('owned cleanup '+index,cleanup);}catch(error){errors.push(error);}
    // Do not erase ownership evidence while any cleanup outcome is uncertain.
    if(!errors.length&&!retainEvidence)try{await bounded('fixture outputs removal',()=>rm(root,{recursive:true,force:true}));}
      catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Owned fixture cleanup incomplete; evidence retained');
  });
  const id='fixture-'+randomUUID().replaceAll('-','').slice(0,12);
  const provider=join(root,'providers',id);
  await mkdir(provider,{recursive:true,mode:0o700});
  const adapter=structuredClone(declaredAdapter),recipe=structuredClone(declaredRecipe);
  adapter.wraps='./wrapped.definition.json';
  adapter.adapter.id=id;adapter.adapter.label='Random registry recipe';
  // This explicit synthetic fixture is executable. Do not weaken the shipped detect-only boundary.
  adapter.adapter.availability.session={state:'available',reason:'explicit-fixture-recipe'};
  recipe.definition.id=id;recipe.definition.label='Random registry recipe';
  const definitionPath=join(provider,'definition.json'),wrappedPath=join(provider,'wrapped.definition.json');
  await writeFile(definitionPath,JSON.stringify(adapter),{mode:0o600});
  await writeFile(wrappedPath,JSON.stringify(recipe),{mode:0o600});
  await writeFile(join(provider,'index.mjs'),
    "import {recipeAdapter} from "+JSON.stringify(runtimeURL)+";\nexport default recipeAdapter({definition:new URL('./definition.json',import.meta.url)});\n",{mode:0o600});
  const manifest={providers:[{id,module:'providers/'+id+'/index.mjs',definition:'providers/'+id+'/definition.json'}]};
  const home=join(root,'h');await mkdir(home,{mode:0o700});
  return {id,root,manifest,home,recipe,wrappedPath,cleanups,retainEvidence:()=>{retainEvidence=true;}};
}
async function handoff(f) {
  const [adapter]=await loadAdapters(f);
  const recipeMapping=sessionRecipeFor(adapter);
  // Public catalog supplies the approved identity, rather than a test digest algorithm.
  const testing=await createTestingGozar({...f,effects:[{kind:'recipe',operation:'probe',
    handle:async()=>({stdout:'',stderr:'OpenSSH_9.9p1\n',exitCode:0})}]});
  let originalError;
  try {
    const catalog=await bounded('catalog handoff',()=>testing.gozar.catalogRoutes(query(f,18765)),OPERATION_MS);
    const candidate=catalog.candidates.find(row=>row.providerId===f.id);
    assert.ok(candidate);
    return {adapterId:f.id,recipeMapping,recipeRegistry:{root:f.root,manifest:f.manifest},
      recipeRegistryId:candidate.consent.scope.registryId,adapters:[recipeMapping.definition],lifetimeMs:HOST_LIFETIME_MS};
  } catch(error){originalError=error;throw error;}
  finally {
    try{await bounded('handoff testing.close',()=>testing.close());}
    catch(error){throw originalError?new AggregateError([originalError,error],'handoff and cleanup failed'):error;}
  }
}
const query=(f,port)=>({schemaVersion:1,owner:'recipe-handoff-fixture',home:f.home,target:'127.0.0.1:'+port,
  providerId:f.id,usage:{kind:'session',lifetimeMs:HOST_LIFETIME_MS},
  requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'none',protocols:[]}});
async function absent(path) {await assert.rejects(lstat(path),{code:'ENOENT'});}
test('registry recipe provenance survives wrapping and rejects changed cached definitions',async t=>{
  const f=await fixture(t),config=await handoff(f);
  assert.deepEqual(await validateSessionRecipe(config),f.recipe.definition);
  assert.equal(config.recipeMapping.definition.idleTimeoutMs,121000);
  const [cached]=await loadAdapters(f);
  const changed=structuredClone(f.recipe);changed.definition.idleTimeoutMs++;
  await writeFile(f.wrappedPath,JSON.stringify(changed),{mode:0o600});
  assert.throws(()=>sessionRecipeFor(cached),{code:'artifact_integrity_failed'});
  await assert.rejects(validateSessionRecipe(config),{code:'artifact_integrity_failed'});
});
for(const change of ['missing','digest','definition','registry'])test('reject '+change+' before launcher allocation and child authority',async t=>{
  const f=await fixture(t),config=await handoff(f);
  if(change==='missing')delete config.recipeMapping;
  if(change==='digest')config.recipeMapping.digest='changed';
  if(change==='definition')config.adapters[0]={...config.adapters[0],idleTimeoutMs:1};
  if(change==='registry')await writeFile(f.wrappedPath,JSON.stringify({...f.recipe,definition:{...f.recipe.definition,idleTimeoutMs:1}}));
  const directory=join(f.home,'not-created');
  await assert.rejects(launch(directory,config,executable),{code:'artifact_integrity_failed'});
  await absent(directory);
  const childHome=join(f.home,'child');await mkdir(childHome,{mode:0o700});
  await writeFile(join(childHome,'bootstrap.json'),JSON.stringify(config),{mode:0o600});
  await assert.rejects(serve(childHome),{code:'artifact_integrity_failed'});
  await absent(join(childHome,'control.sock'));
});
async function stopChild(child) {
  if(exited(child))return;
  // Only ChildProcess handles saved at allocation are signalled.
  child.kill('SIGTERM');
  try{await waitReaped(child,'owned SIGTERM');}
  catch(first){
    if(!exited(child))child.kill('SIGKILL');
    try{await waitReaped(child,'owned SIGKILL');}
    catch(second){throw new AggregateError([first,second],'Owned child not reaped');}
    // Escalation succeeded, but retain the original timeout as a test failure.
    throw first;
  }
}
async function transport(t,f,mode) {
  const children=new Map(),upstreams=new Set(),resolvers=new Set();let creates=0,closes=0,gatePort,nonceResponses=0,requests=0,closing=false;
  f.cleanups.push(async()=>{for(const req of upstreams)req.destroy(new Error('fixture teardown'));});
  const origin='https://'+f.id+'.tunnl.gg';
  const foreign=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:{}});
  f.cleanups.push(()=>stopChild(foreign));
  await bounded('foreign fixture spawn',()=>once(foreign,'spawn'));
  const app=http.createServer((_req,res)=>{res.setHeader('content-type','text/plain');res.end('fixture app');});
  const sockets=new Set();
  app.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  f.cleanups.push(async()=>{
    const closing=new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve()));
    for(const socket of sockets)socket.destroy();
    await bounded('app server close',()=>closing);
  });
  await bounded('app server listen',()=>new Promise((resolve,reject)=>{
    app.once('error',reject);app.listen(0,'127.0.0.1',resolve);
  }));
  f.cleanups.push(async()=>{
    const outcomes=await Promise.allSettled([...children.values()].map(child=>stopChild(child)));
    const errors=outcomes.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(errors.length)throw new AggregateError(errors,'Owned child cleanup failures');
  });
  const probe=args=>{assert.deepEqual(args,['-V']);return {stdout:'',stderr:'OpenSSH_9.9p1\n',exitCode:0};};
  const effects=[
    {kind:'recipe',operation:'probe',handle:async({recipe})=>probe(recipe.args)},
    {kind:'spawn',operation:'run',handle:async({args,longRunning})=>{
      if(closing)throw new Error('Fixture allocation after teardown began');
      if(!longRunning)return probe(args);
      assert.ok(args.includes('output=json'));
      gatePort=Number(args[args.indexOf('-R')+1].split(':').at(-1));assert.ok(gatePort>0);
      const entries=await readdir(f.home,{withFileTypes:true});
      for(const entry of entries.filter(e=>/^resolver-[a-f0-9]{12}\.sock$/.test(e.name))){
        assert.ok(entry.isSocket(),'resolver entry must be a socket');resolvers.add(join(f.home,entry.name));
      }
      assert.ok(resolvers.size,'capture actual resolver before allocation');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:{}});
      const handle=randomUUID();children.set(handle,child);creates++;
      await bounded('owned fixture spawn',()=>once(child,'spawn'));
      return {stdout:mode==='invalid'?'https://fixture.lhr.life\n':JSON.stringify({event:'tunnel',url:origin})+'\n',
        stderr:'',exitCode:null,pid:child.pid,handle};
    }},
    {kind:'spawn',operation:'read',handle:async({handle})=>{
      const child=children.get(handle);assert.ok(child);
      return {present:child.exitCode===null&&child.signalCode===null,...(child.exitCode===null?{}:{exitCode:child.exitCode})};
    }},
    {kind:'spawn',operation:'close',handle:async({handle})=>{
      const child=children.get(handle);assert.ok(child);await stopChild(child);closes++;return {closed:true};
    }},
    {kind:'network',operation:'fetch',handle:async({url,method,headers},{signal})=>{
      const requested=new URL(url);assert.equal(requested.origin,origin);assert.ok(gatePort);
      requests++;
      if(mode==='late-failure')throw new Error('Synthetic transport failure after owned allocation');
      return new Promise((resolve,reject)=>{
        const upstream=http.request({host:'127.0.0.1',port:gatePort,path:requested.pathname+requested.search,
          method,headers:{...headers,host:headers?.host??headers?.Host??requested.host},signal},reply=>{
          const chunks=[];let bytes=0,last=performance.now();
          reply.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024){upstream.destroy(new Error('bounded response'));return;}
            const now=performance.now();chunks.push({data:chunk.toString('base64'),delayMs:now-last});last=now;});
          reply.once('error',reject);
          reply.once('end',()=>{if(reply.statusCode===200&&bytes>0)nonceResponses++;
            resolve({status:reply.statusCode,headers:Object.fromEntries(Object.entries(reply.headers).filter(([,v])=>v!==undefined)
              .map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v])),chunks});});
        });
        upstreams.add(upstream);
        const deadline=setTimeout(()=>upstream.destroy(new Error('fixture HTTP deadline; proof incomplete')),HOST_LIFETIME_MS);
        upstream.once('close',()=>{clearTimeout(deadline);upstreams.delete(upstream);});
        upstream.once('error',reject);upstream.end();
      });
    }},
  ];
  const testing=await createTestingGozar({...f,effects,identity:{instanceId:'recipe-fixture-'+f.id,bootId:randomUUID()}});
  f.cleanups.push(()=>{closing=true;return testing.close();});
  return {...testing,origin,port:app.address().port,foreign,
    confirmForeign:async()=>{
      assert.equal(foreign.exitCode,null);assert.equal(foreign.signalCode,null);
      await bounded('foreign application survives',()=>new Promise((resolve,reject)=>{
        const req=http.get({host:'127.0.0.1',port:app.address().port,path:'/'},res=>{
          let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
          res.once('end',()=>{try{assert.equal(res.statusCode,200);assert.equal(body,'fixture app');resolve();}catch(error){reject(error);}});
          res.once('error',reject);
        });
        req.setTimeout(1500,()=>req.destroy(new Error('foreign application timeout')));
        req.once('error',reject);
      }));
    },
    confirmRemoved:async()=>{
      assert.equal(children.size,1,'exactly one saved owned child');
      for(const child of children.values())await waitReaped(child,'public cleanup owned PID');
      assert.ok([...children.values()].every(exited),'no live saved owned child');
      await endpointUnavailable(gatePort);
      try {
        assert.ok((await lstat(f.home)).isDirectory(),'home must exist before absence checks');
        for(const path of resolvers)await bounded('resolver connection refusal',()=>resolverUnavailable(path));
        assert.deepEqual((await readdir(f.home)).filter(name=>/^resolver-[a-f0-9]{12}\.sock$/.test(name)),[]);
      } catch(error){f.retainEvidence();throw error;}
    },
    facts:()=>({creates,closes,nonceResponses,requests,ownedPids:[...children.values()].map(c=>c.pid),live:[...children.values()].filter(c=>c.exitCode===null&&c.signalCode===null).length})};
}
for(const mode of ['positive','invalid','late-failure'])test('actual daemon, gate and exact cleanup: '+mode,{timeout:90000},async t=>{
  const f=await fixture(t),effect=await transport(t,f,mode),request=query(f,effect.port);
  t.after(()=>t.diagnostic(JSON.stringify({mode,...effect.facts()})));
  try {
  const catalog=await bounded('public route catalog',()=>effect.gozar.catalogRoutes(request),OPERATION_MS),candidate=catalog.candidates.find(c=>c.providerId===f.id);
  assert.equal(candidate?.eligible,true);assert.equal(candidate.setup.state,'ready');assert.ok(candidate.candidateToken);
  const start=effect.gozar.expose({...request,approval:{kind:'route',candidateToken:candidate.candidateToken,
    consentFactsDigest:candidate.consentFactsDigest,disclosureRevision:candidate.disclosure.revision},wait:'verified'});
  if(mode==='positive') {
    const route=await bounded('verified expose',()=>start,OPERATION_MS);
    assert.equal(route.state,'usable');assert.equal(route.origin,effect.origin);
    assert.equal(route.limits.idleTimeoutMs,121000);
    assert.equal(route.verification.status,'verified');assert.ok(route.verification.checks.includes('nonce'));
    assert.equal(route.verification.subject.origin,effect.origin);
    assert.equal(route.verification.subject.handleGeneration,route.handle.generation);
    assert.ok(route.handle.generation>=1);
    assert.equal(route.expiresAt.known,true);assert.ok(Number.isFinite(Date.parse(route.expiresAt.value)));assert.ok(Date.parse(route.expiresAt.value)>Date.now());assert.ok(Date.parse(route.expiresAt.value)<=Date.now()+HOST_LIFETIME_MS);
    assert.equal(effect.facts().creates,1);assert.ok(effect.facts().nonceResponses>0);
    const status=await bounded('public route status',()=>effect.gozar.routeStatus({home:f.home,handle:route.handle}));
    assert.equal(status.handle.id,route.handle.id);assert.equal(status.state,'usable');
    assert.equal(status.limits.idleTimeoutMs,121000);
    assert.deepEqual(status.handle,route.handle);
    assert.deepEqual(status.expiresAt,route.expiresAt);
    assert.deepEqual(status.verification,route.verification,'metadata does not restamp the observed proof');
    const replay=await bounded('repeated public route status',()=>effect.gozar.routeStatus({home:f.home,handle:route.handle}));
    assert.equal(replay.limits.idleTimeoutMs,121000);
    assert.deepEqual(replay.handle,route.handle);
    assert.deepEqual(replay.expiresAt,route.expiresAt);
    assert.deepEqual(replay.verification,route.verification);
    assert.equal(effect.facts().creates,1,'status must not allocate another owned child');
    const scope={home:f.home,owner:request.owner,providerId:f.id};
    const current=(await bounded('live configuration',()=>effect.gozar.catalogRoutes(request),OPERATION_MS)).candidates.find(c=>c.providerId===f.id).configuration;
    const liveDraft=await bounded('live draft',()=>effect.gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.revision}));
    await assert.rejects(bounded('live commit must remain in use',()=>effect.gozar.commitConfigurationDraft({...scope,draftId:liveDraft.draftId,expectedConfigurationRevision:liveDraft.configuration.revision})),{code:'configuration_in_use'});
    await bounded('discard live draft',()=>effect.gozar.discardConfigurationDraft({...scope,draftId:liveDraft.draftId}));
    const stopped=await bounded('public route removal',()=>effect.gozar.closeRoute({home:f.home,handle:route.handle,mode:'remove'}));
    t.diagnostic(JSON.stringify({mode,publicCleanup:stopped.cleanup?.state,...effect.facts()}));
    assert.equal(stopped.cleanup.state,'confirmed');
  } else {
    let failure;
    await assert.rejects(bounded('negative expose '+mode,()=>start,OPERATION_MS),error=>{
      failure=error;
      return ['provider_unavailable','verification_failed','requirements_unsatisfied'].includes(error.code)
        ||(mode==='late-failure'&&error.code==='cleanup_debt');
    });
    const allocated=effect.facts();
    assert.equal(allocated.creates,1,'negative must exercise the real allocated recipe, not an earlier refusal');
    assert.equal(allocated.nonceResponses,0,'failed transport cannot prove a nonce');
    if(mode==='late-failure')assert.ok(allocated.requests>0);
    if(failure.code==='cleanup_debt'){
      assert.equal(mode,'late-failure');
      const retained=failure.route;
      assert.ok(retained,'cleanup debt needs the exact public recovery handle');
      const handle=structuredClone(retained.handle);
      assert.equal(handle.kind,'session');assert.equal(handle.generation,1);
      assert.match(handle.id,new RegExp('^port-'+effect.port+':[A-Za-z0-9_-]+$'));
      assert.equal(retained.hostConfiguration.target.known,true);
      assert.equal(retained.hostConfiguration.target.value,request.target);
      if(request.operationId!==undefined)assert.equal(retained.operationId,request.operationId);
      assert.equal(retained.published,null);assert.equal(retained.verification.status,'unverified');
      assert.equal(retained.cleanup.state,'unconfirmed');
      assert.equal(retained.cleanup.nextAction?.kind,'instructions');
      assert.equal(retained.cleanup.nextAction.id,'stop-session');
      assert.ok(retained.cleanup.nextAction.instructions);
      await effect.confirmForeign();
      const scope={home:f.home,owner:request.owner,providerId:f.id};
      const current=(await bounded('debt configuration',()=>effect.gozar.catalogRoutes(request),OPERATION_MS))
        .candidates.find(c=>c.providerId===f.id).configuration;
      const draft=await bounded('debt draft',()=>effect.gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.revision}));
      try{
        await assert.rejects(bounded('debt blocks current draft',()=>effect.gozar.commitConfigurationDraft({
          ...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision})),{code:'configuration_in_use'});
      }finally{await bounded('discard debt draft',()=>effect.gozar.discardConfigurationDraft({...scope,draftId:draft.draftId}));}
      const before=effect.facts();
      let closed;
      for(let attempt=1;attempt<=3;attempt++){
        try{closed=await bounded('exact debt close '+attempt,()=>effect.gozar.closeRoute({home:f.home,handle,mode:'remove'}));}
        catch(error){
          assert.equal(error.code,'cleanup_debt','only typed retained debt permits another close');
          closed=error.route;assert.ok(closed,'close debt must preserve recovery identity');
        }
        assert.deepEqual(closed.handle,handle,'close must retain exact session and generation');
        assert.equal(closed.published,null);
        const after=effect.facts();
        assert.equal(after.creates,before.creates,'reconciliation must not allocate');
        assert.equal(after.requests,before.requests,'reconciliation must not verify');
        assert.equal(after.nonceResponses,0);
        assert.deepEqual(after.ownedPids,before.ownedPids,'no replacement PID');
        if(closed.cleanup.state==='confirmed')break;
        assert.equal(closed.cleanup.state,'unconfirmed','unknown cleanup is not recovery');
        assert.equal(closed.cleanup.nextAction?.kind,'instructions');
      }
      assert.equal(closed.cleanup.state,'confirmed','persistent debt after three exact closes; evidence retained');
      t.diagnostic(JSON.stringify({mode,publicCleanup:closed.cleanup.state,handle,...effect.facts()}));
      await effect.confirmForeign();
    }
  }
  await effect.confirmRemoved();
  const current=(await bounded('current applied configuration',()=>effect.gozar.catalogRoutes(request),OPERATION_MS)).candidates.find(c=>c.providerId===f.id).configuration;
  const scope={home:f.home,owner:request.owner,providerId:f.id};
  const draft=await bounded('unchanged draft',()=>effect.gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.revision}));
  const committed=await bounded('commit after exact reference release',()=>effect.gozar.commitConfigurationDraft({...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision}));
  assert.ok(committed.revision);
  assert.equal(effect.facts().live,0,'every owned fixture process stopped');
  await effect.confirmForeign();
  }catch(error){f.retainEvidence();throw error;}
});
