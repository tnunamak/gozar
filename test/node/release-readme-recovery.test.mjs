import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The README example is extracted verbatim and run against a recording stand-in for the package.
// It checks the example's own control flow (recovery order), not the real route runtime.
const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const marker = "import { catalogRoutes, expose, listRoutes, watchRoutes, closeRoute }";
const start = readme.lastIndexOf('```js\n', readme.indexOf(marker)) + 6;
const snippet = readme.slice(start, readme.indexOf('\n```', start));

const candidate = {
 eligible: true, candidateToken: 'fixture-candidate-token', consentFactsDigest: 'fixture-facts-digest',
 disclosure: {revision: 'fixture-disclosure-v1', text: 'Fixture provider can read this route traffic.'},
 consent: {disclosures: ['Fixture disclosure: no application authentication.'], facts: [
  {affectsConsent: true, label: 'Fixture audience', known: true, value: 'internet'},
  {affectsConsent: true, label: 'Fixture cost', known: false, reason: 'needs-provider-call'},
  {affectsConsent: false, label: 'Hidden implementation fact', known: true, value: 'not consent'},
 ]},
};
const fakePackage = [
 "import {appendFileSync,readFileSync} from 'node:fs';",
 "const log=(name,arg)=>appendFileSync(process.env.FAKE_LOG,JSON.stringify({name,arg})+'\\n');",
 "export const catalogRoutes=async query=>{log('catalogRoutes',query);",
 " if(process.env.FAKE_CATALOG==='fail')throw new Error('catalog down');",
 " return process.env.FAKE_CATALOG==='eligible'?{candidates:["+JSON.stringify(candidate)+"]}:{candidates:[],noMatch:{code:'no_candidates'}};};",
 "export const listRoutes=async arg=>{log('listRoutes',arg);",
 " if(process.env.FAKE_LIST==='fail')throw new Error('list failed');",
 " if(process.env.FAKE_LIST==='empty')return {routes:[]};",
 " const state=process.env.FAKE_LIST==='confirmed'?'confirmed':'pending';",
 " return {routes:[{operationId:process.env.FAKE_OPERATION_ID,handle:'h-1',cleanup:{state},published:'https://old.example'}]};};",
 // This witness is set only by the parent after it sees the prompt and chooses y.
 // It catches expose-before-consent even when stdout/log writes are observed in different orders.
 "export const expose=async arg=>{log('expose',arg);",
 " let approval;try{approval=readFileSync(process.env.FAKE_APPROVAL,'utf8');}catch{}",
 " if(approval!=='y')throw new Error('expose preceded affirmative parent input');",
 " if(process.env.FAKE_CATALOG!=='eligible')throw new Error('expose must not run on recovery');",
 " return {handle:'h-new',published:'https://new.example',cleanup:{state:'pending'}};};",
 "export const watchRoutes=async function*(){};",
 "export const closeRoute=async arg=>{log('closeRoute',arg);return {cleanup:{state:process.env.FAKE_CLOSE==='unconfirmed'?'pending':'confirmed'}};};",
].join('\n');
const retainedHomes = new Set();
const intentPath = home => join(home, '.gozar-route-example', 'demo-route.json');
const readCalls = async log => (await readFile(log,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));

async function seedHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'readme-recovery-'));
  t.after(() => retainedHomes.has(home) ? undefined : rm(home, {recursive: true, force: true}));
  const pkg = join(home, 'node_modules', '@tnunamak', 'gozar');
  await mkdir(pkg, {recursive: true});
  await writeFile(join(pkg, 'package.json'), JSON.stringify({name: '@tnunamak/gozar', type: 'module', exports: './index.mjs'}));
  await writeFile(join(pkg, 'index.mjs'), fakePackage);
  await writeFile(join(home, 'route-example.mjs'), snippet);
  return home;
}
// Runs the extracted example once in `home`; the app intent file under home persists between runs.
async function exec(home, env, operationId = '', answer = 'y') {
  const log = join(home, 'calls.jsonl');
  const approval = join(home, 'approval.txt');
  await writeFile(log, '');
  await rm(approval, {force: true});
  const child = spawn(process.execPath, [join(home, 'route-example.mjs')], {
    cwd: home, stdio: ['pipe', 'pipe', 'pipe'],
    env: {PATH: process.env.PATH, HOME: home, GOZAR_HOME: join(home, 'state'), FAKE_LOG: log,
      FAKE_APPROVAL: approval, FAKE_OPERATION_ID: operationId, ...env},
  });
  let out='',err='',failure,closed=false,finished=false,watchdog,teardownTimer,code;
  let resolveClose;
  const close = new Promise(resolve=>{resolveClose=resolve;});
  const fail = error => {
    if(finished)return;
    failure ??= error;
    retainedHomes.add(home);
    if(!closed){
      child.kill('SIGKILL');
      teardownTimer ??= setTimeout(()=>{
        failure.cleanupError=new Error('Owned README subprocess closure is unconfirmed');
        child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();
        resolveClose();
      },5000);
    }
  };
  child.on('error',fail);
  child.stdin.on('error',fail); // EPIPE is handled and fails the harness, never an unhandled event.
  child.once('close',value=>{closed=true;code=value;resolveClose();});
  child.stderr.on('data',d=>{err+=d;});
  const answered=new Set();
  let responding=Promise.resolve();
  async function respond(){
    for(const [prompt,value] of [
      ['Create this route? [y/N] ',answer],
      ['Inspect and close this recovered route? [y/N] ',answer],
      ['Press Enter to close the route ',''],
    ]){
      if(!out.includes(prompt)||answered.has(prompt)||closed||failure)continue;
      answered.add(prompt);
      if(prompt.startsWith('Create')){
        assert.equal((await readCalls(log)).some(call=>call.name==='expose'),false,'expose must not precede approval');
        assert.ok(out.includes(candidate.disclosure.text));
        assert.ok(out.includes(candidate.consent.disclosures[0]));
        assert.ok(out.includes('Fixture audience internet'));
        assert.ok(out.includes('Fixture cost unknown (needs-provider-call)'));
        assert.equal(out.includes('Hidden implementation fact'),false);
        if(value==='y')await writeFile(approval,'y');
      }
      if(closed||failure)return;
      await new Promise((resolve,reject)=>child.stdin.write(value+'\n',error=>error?reject(error):resolve()));
    }
  }
  child.stdout.on('data',d=>{
    out+=d;
    responding=responding.then(respond).catch(fail);
  });
  watchdog=setTimeout(()=>fail(new Error('README subprocess exceeded its setup/settlement watchdog')),30000);
  try {
    await close;
    await responding;
    if(failure)throw failure;
    const calls=await readCalls(log);
    return {code,out,err,calls,names:calls.map(call=>call.name),prompts:[...answered]};
  } finally {
    finished=true;
    clearTimeout(watchdog);clearTimeout(teardownTimer);
    child.stdin.destroy();
  }
}
// Every restart, including refusal, must preserve the exact saved bytes.
async function secondRun(home,env,operationId,answer='y'){
  const before=await readFile(intentPath(home));
  const result=await exec(home,env,operationId,answer);
  assert.deepEqual(await readFile(intentPath(home)),before,'restart must not rewrite saved intent');
  return result;
}
// First run: new allocation. The catalog finds nothing, but the intent and operation ID are saved first.
async function firstRun(t) {
  const home = await seedHome(t);
  const first = await exec(home, {});
  assert.notEqual(first.code, 0);
  assert.deepEqual(first.names, ['catalogRoutes']);
  const saved = JSON.parse(await readFile(join(home, '.gozar-route-example', 'demo-route.json'), 'utf8'));
  return {home, operationId: saved.operationId};
}

test('README recovery closes a retained route without the catalog, approval or expose, even when the catalog is down', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await secondRun(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'pending'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes', 'closeRoute']);
  assert.equal(second.calls[1].arg.handle, 'h-1');
  assert.equal(second.calls[1].arg.mode, 'remove');
  assert.match(second.out, /Not currently published/); // historical publication is suppressed
  assert.doesNotMatch(second.out, /old\.example/);
});
test('a confirmed terminal operation ends with no catalog, no close and no expose', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await secondRun(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'confirmed'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes']);
  assert.match(second.out, /already closed/);
});
test('a failed listing refuses the restart: no catalog, no expose, no close', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await secondRun(home, {FAKE_LIST: 'fail'}, operationId);
  assert.notEqual(second.code, 0);
  assert.match(second.err, /list failed/);
  assert.deepEqual(second.names, ['listRoutes']);
});

const expectedQuery = home => ({
 schemaVersion:1,owner:'example-app',target:'127.0.0.1:18765',home:join(home,'state'),
 usage:{kind:'session',lifetimeMs:900_000},
 requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'none',protocols:[]},
});
function assertAllocation(result,home,saved,restarting){
 assert.equal(result.code,0,result.err);
 assert.equal(saved.version,1);
 assert.match(saved.operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
 assert.deepEqual(JSON.parse(saved.intent),expectedQuery(home));
 assert.deepEqual(result.calls,[
  ...(restarting?[{name:'listRoutes',arg:{home:join(home,'state'),owner:'example-app'}}]:[]),
  {name:'catalogRoutes',arg:expectedQuery(home)},
  {name:'expose',arg:{...expectedQuery(home),operationId:saved.operationId,wait:'verified',
   approval:{candidateToken:'fixture-candidate-token',consentFactsDigest:'fixture-facts-digest',
    kind:'route',disclosureRevision:'fixture-disclosure-v1'}}},
  {name:'closeRoute',arg:{home:join(home,'state'),handle:'h-new',mode:'remove'}},
 ]);
 assert.deepEqual(result.prompts,['Create this route? [y/N] ','Press Enter to close the route ']);
 assert.match(result.out,/Published at https:\/\/new\.example/);
 assert.equal(saved.intent.includes('fixture-candidate-token'),false);
}
test('fresh README allocation displays consent and sends the exact approved request',async t=>{
 const home=await seedHome(t);
 const result=await exec(home,{FAKE_CATALOG:'eligible'});
 const saved=JSON.parse(await readFile(intentPath(home),'utf8'));
 assertAllocation(result,home,saved,false);
});
test('restart with no retained route allocates only under the original operation and approval',async t=>{
 const {home,operationId}=await firstRun(t);
 const saved=JSON.parse(await readFile(intentPath(home),'utf8'));
 const result=await secondRun(home,{FAKE_CATALOG:'eligible',FAKE_LIST:'empty'},operationId);
 assertAllocation(result,home,saved,true);
});
test('answering n refuses allocation without expose or close',async t=>{
 const {home,operationId}=await firstRun(t);
 const result=await secondRun(home,{FAKE_CATALOG:'eligible',FAKE_LIST:'empty'},operationId,'n');
 assert.equal(result.code,0,result.err);
 assert.deepEqual(result.calls,[
  {name:'listRoutes',arg:{home:join(home,'state'),owner:'example-app'}},
  {name:'catalogRoutes',arg:expectedQuery(home)},
 ]);
 assert.deepEqual(result.prompts,['Create this route? [y/N] ']);
 assert.doesNotMatch(result.out,/Published at/);
});
test('catalog failure refuses allocation and preserves saved intent',async t=>{
 const {home,operationId}=await firstRun(t);
 const result=await secondRun(home,{FAKE_CATALOG:'fail',FAKE_LIST:'empty'},operationId);
 assert.notEqual(result.code,0);
 assert.match(result.err,/^Error: catalog down$/m);
 assert.deepEqual(result.calls,[
  {name:'listRoutes',arg:{home:join(home,'state'),owner:'example-app'}},
  {name:'catalogRoutes',arg:expectedQuery(home)},
 ]);
 assert.deepEqual(result.prompts,[]);
});
test('only a changed saved target refuses before any package call',async t=>{
 const {home,operationId}=await firstRun(t);
 const saved=JSON.parse(await readFile(intentPath(home),'utf8'));
 const intent=JSON.parse(saved.intent);intent.target='127.0.0.1:18766';
 saved.intent=JSON.stringify(intent);
 assert.equal(saved.version,1);assert.equal(saved.operationId,operationId);
 await writeFile(intentPath(home),JSON.stringify(saved)+'\n');
 const result=await secondRun(home,{FAKE_CATALOG:'eligible',FAKE_LIST:'empty'},operationId);
 assert.notEqual(result.code,0);
 assert.match(result.err,/^Error: Different or unreadable intent: keep this file and reconcile the original request$/m);
 assert.deepEqual(result.calls,[]);
 assert.deepEqual(result.prompts,[]);
});
test('unconfirmed recovered close retains intent and the exact cleanup handle',async t=>{
 const {home,operationId}=await firstRun(t);
 const result=await secondRun(home,{FAKE_CATALOG:'fail',FAKE_LIST:'pending',FAKE_CLOSE:'unconfirmed'},operationId);
 assert.notEqual(result.code,0);
 assert.match(result.err,/^Error: Cleanup is unconfirmed; retain the handle and retry closeRoute$/m);
 assert.deepEqual(result.calls,[
  {name:'listRoutes',arg:{home:join(home,'state'),owner:'example-app'}},
  {name:'closeRoute',arg:{home:join(home,'state'),handle:'h-1',mode:'remove'}},
 ]);
 assert.deepEqual(result.prompts,['Inspect and close this recovered route? [y/N] ','Press Enter to close the route ']);
});
