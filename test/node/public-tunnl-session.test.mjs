import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {existsSync,statSync,readFileSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';

// The real tunnl-gg adapter through the public API only. The fixture host speaks the relay's source-shaped protocol:
// `ssh ... -R 80:127.0.0.1:PORT stable@proxy.tunnl.gg output=json` answers one JSON event line with a *.tunnl.gg URL.
const EVENT=url=>JSON.stringify({event:'tunnel',url,upgrade:'https://tunnl.gg/pricing'})+'\n';
const keyDigest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const optionOf=(args,name)=>args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);

async function world(t,{announce,providerId='tunnl-gg',registry}={}){
 const home=await scratch(t),ledger=new Map(),runs=[],fetched=[];
 const verifier=createServiceVerifier(),app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 let target;
 const effects=[
  {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.6p1',stderr:'',exitCode:0})},
  {kind:'spawn',operation:'run',handle:async input=>{
   if(!input.longRunning)return {stdout:'OpenSSH_9.6p1',stderr:'',exitCode:0};
   runs.push(structuredClone(input));
   target=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');
   const knownHosts=optionOf(input.args.filter((_,i)=>input.args[i-1]==='-o'),'UserKnownHostsFile'),identity=optionOf(input.args.filter((_,i)=>input.args[i-1]==='-o'),'IdentityFile');
   const seen={knownHosts,identity,knownHostsExists:existsSync(knownHosts??''),identityExists:existsSync(identity??''),
    identityMode:identity&&existsSync(identity)?statSync(identity).mode&0o777:null,knownHostsMode:knownHosts&&existsSync(knownHosts)?statSync(knownHosts).mode&0o777:null,
    identityHead:identity&&existsSync(identity)?readFileSync(identity,'utf8').split('\n')[0]:null,
     identityDigest:identity&&existsSync(identity)?keyDigest(identity):null};
   runs.at(-1).seen=seen;
   const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
   const handle='fixture-ssh-'+ledger.size;ledger.set(handle,{child});
   return {handle,pid:child.pid,stdout:announce(target),stderr:'',exitCode:null};
  }},
  {kind:'spawn',operation:'read',handle:async({handle})=>({present:ledger.get(handle)?.child.exitCode===null&&ledger.get(handle)?.child.signalCode===null})},
  {kind:'spawn',operation:'close',handle:async({handle})=>{ledger.get(handle)?.child.kill();return {closed:true};}},
  {kind:'network',operation:'fetch',handle:async request=>{
   const url=new URL(request.url);fetched.push(url.origin);assert.ok(target);
   const response=await fetch(`http://${target}${url.pathname}`,{headers:request.headers});
   const chunks=[];let before=Date.now();for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
   return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }},
 ];
 const harness=await createTestingGozar({effects,...(registry??{})});
 t.after(async()=>{await harness.close();for(const {child} of ledger.values())child.kill();});
 const api=harness.gozar;
 const q=query({home,providerId,operationId:'tunnl-public-session',target:'127.0.0.1:'+app.address().port,usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const candidate=async()=>(await api.catalogRoutes(q)).candidates[0];
 const approval=c=>({kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest});
 return {api,home,q,ledger,runs,fetched,candidate,approval};
}

test('tunnl.gg starts, proves, stops and cleans up through the generic operational runtime',async t=>{
 const w=await world(t,{announce:()=>EVENT('https://wild-fox-10bf6aa2.tunnl.gg')});
 const c=await w.candidate();assert.equal(c.eligible,true,JSON.stringify(c.unmet));assert.ok(c.candidateToken);
 await assert.rejects(w.api.expose({...w.q,wait:'verified'}),{code:'consent_required'});
 assert.equal(w.runs.length,0,'an unknown host key is never accepted without route approval');
 const retainedIdentity=join(w.home,'identities','ed25519');
 assert.equal(existsSync(retainedIdentity),false,'the rejected route must not create an installation identity');
 const route=await w.api.expose({...w.q,wait:'verified',approval:w.approval(c)});
 assert.equal(route.verification.status,'verified');
 assert.equal(route.published,'https://wild-fox-10bf6aa2.tunnl.gg');
 assert.equal(w.runs.length,1);
 const [run]=w.runs;
 assert.equal(run.program,'ssh');
 assert.ok(run.args.includes('stable@proxy.tunnl.gg')&&run.args.includes('output=json'));
 assert.ok(run.args.some(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg)),'the tunnel forwards only to a loopback gate port');
 assert.ok(!run.args.some(arg=>arg===`80:127.0.0.1:${new URL('http://'+w.q.target).port}`),'the relay reaches the gate, never the app directly');
 assert.equal(run.seen.knownHostsExists,true,'a private known_hosts file exists before the process starts');
 assert.equal(run.seen.identityExists,true,'the owned installation identity exists before the process starts');
 assert.equal(run.seen.knownHostsMode,0o600);assert.equal(run.seen.identityMode,0o600);
 assert.match(run.seen.identityHead,/^-----BEGIN OPENSSH PRIVATE KEY-----$/);
 assert.ok(run.args.includes('StrictHostKeyChecking=accept-new')&&run.args.includes('GlobalKnownHostsFile=/dev/null'));
 assert.ok(w.fetched.every(origin=>origin==='https://wild-fox-10bf6aa2.tunnl.gg'));
 const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
 const foreignExit = once(foreign, 'exit');
 t.after(async()=>{foreign.kill();await foreignExit;});
 await once(foreign, 'spawn');
 const foreignKey = join(w.home, 'foreign-known-hosts');
 await writeFile(foreignKey, 'foreign-key-sentinel', {mode:0o600,flag:'wx'});
 w.ledger.set('same-origin-after-replacement', {child:foreign, origin:route.origin});
 const owned = w.ledger.get('fixture-ssh-0').child;
 const closed=await w.api.closeRoute({home:w.home,handle:route.handle,mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');
 assert.ok(owned.exitCode!==null||owned.signalCode!==null,'the owned process is gone');
 assert.equal(foreign.exitCode,null);
 assert.equal(foreign.signalCode,null,'another process with the same advertised origin survives');
 assert.equal(await readFile(foreignKey,'utf8'),'foreign-key-sentinel');
 assert.equal(existsSync(run.seen.knownHosts),false,'private files are removed with the session');
 assert.equal(existsSync(run.seen.identity),false);
 assert.equal(keyDigest(retainedIdentity),run.seen.identityDigest,'retained installation key matches the full bytes of the temporary session copy');
});

test('the invalid canned hostname of a generic fixture is refused: no route is published and nothing stays owned',async t=>{
 const w=await world(t,{announce:()=>'https://fixture.lhr.life\n'});
 const c=await w.candidate();assert.ok(c.candidateToken);
 const error=await w.api.expose({...w.q,wait:'verified',approval:w.approval(c)}).then(()=>null,e=>e);
 assert.ok(error,'a hostname outside *.tunnl.gg is not tunnl.gg output');
 assert.equal(error.route?.published??null,null);
 assert.deepEqual(w.fetched,[],'nothing was proven against an unaccepted origin');
 const closed=await w.api.closeRoute({home:w.home,handle:error.route.handle,mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');
 for(const {child} of w.ledger.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
});

// A provider the library has never heard of, written as data only: same recipe lifecycle (private known_hosts, owned
// installation identity, output parser), a different relay hostname and a different JSON event shape. It runs on the same
// generic runtime, so the runtime holds no tunnl-specific code path.
async function unknownRelay(t,id='acme-relay'){
 const root=await scratch(t),shipped=new URL('../../adapters/',import.meta.url);
 const provider=JSON.parse(await readFile(new URL('providers/tunnl-gg/definition.json',shipped),'utf8')),wrapped=JSON.parse(await readFile(new URL('tunnl-gg.definition.json',shipped),'utf8'));
 const text=JSON.stringify(provider).replaceAll('tunnl-gg',id).replaceAll('tunnl.gg trial','Acme relay trial').replaceAll('tunnl.gg','relay.acme.test');
 const adapter=JSON.parse(text).adapter;
 const recipe=wrapped.definition;recipe.id=id;
 recipe.recipes.create.args=recipe.recipes.create.args.map(arg=>arg==='stable@proxy.tunnl.gg'?'edge@proxy.relay.acme.test':arg==='output=json'?'format=json':arg);
 recipe.recipes.create.parser.constraints.hostnamePattern='^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.relay\\.acme\\.test$';
 recipe.recipes.create.parser.jsonEvent={eventPointer:'/kind',eventValue:'ready',originPointer:'/endpoint'};
 const folder=join(root,'providers',id);await mkdir(folder,{recursive:true});
 const runtime=pathToFileURL(fileURLToPath(new URL('../../packages/gozar-node/adapter-runtime.mjs',import.meta.url))).href;
 await writeFile(join(folder,'definition.json'),JSON.stringify({wraps:'./wrapped.definition.json',adapter}));
 await writeFile(join(folder,'wrapped.definition.json'),JSON.stringify(wrapped));
 await writeFile(join(folder,'index.mjs'),`import {recipeAdapter} from ${JSON.stringify(runtime)};\nexport default recipeAdapter({definition:new URL('./definition.json',import.meta.url),excludeActions:['trial-consent']});\n`);
 return {manifest:{providers:[{id,module:`providers/${id}/index.mjs`,definition:`providers/${id}/definition.json`}]},root};
}
const READY=url=>JSON.stringify({kind:'ready',endpoint:url})+'\n';

test('an unknown relay provider declared only as data runs through the same lifecycle',async t=>{
 const registry=await unknownRelay(t);
 const w=await world(t,{providerId:'acme-relay',registry,announce:()=>READY('https://quiet-owl.relay.acme.test')});
 const c=await w.candidate();assert.equal(c.eligible,true,JSON.stringify(c.unmet));
 const route=await w.api.expose({...w.q,wait:'verified',approval:w.approval(c)});
 assert.equal(route.verification.status,'verified');assert.equal(route.published,'https://quiet-owl.relay.acme.test');
 const [run]=w.runs;assert.ok(run.args.includes('edge@proxy.relay.acme.test'));
 assert.equal(run.seen.knownHostsMode,0o600);assert.equal(run.seen.identityMode,0o600);
 assert.equal((await w.api.closeRoute({home:w.home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 for(const {child} of w.ledger.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
 assert.equal(existsSync(run.seen.identity),false);
});

test('an unknown relay refuses the announcement of a hostname outside its declared pattern',async t=>{
 const registry=await unknownRelay(t);
 const w=await world(t,{providerId:'acme-relay',registry,announce:()=>READY('https://quiet-owl.tunnl.gg')});
 const c=await w.candidate();assert.ok(c.candidateToken);
 const error=await w.api.expose({...w.q,wait:'verified',approval:w.approval(c)}).then(()=>null,e=>e);
 assert.ok(error);assert.equal(error.route?.published??null,null);assert.deepEqual(w.fetched,[]);
 assert.equal((await w.api.closeRoute({home:w.home,handle:error.route.handle,mode:'remove'})).cleanup.state,'confirmed');
});
