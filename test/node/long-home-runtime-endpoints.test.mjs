import assert from 'node:assert/strict';
import net from 'node:net';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeAttachedRoute, controlAttached, openAttachedRoute } from '../../packages/gozar-node/attached-route.mjs';
import { connectEmbeddingBroker, startEmbeddingBroker } from '../../packages/gozar-node/embedding-broker.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { query, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const stubUrl = new URL('./route-schema-check.mjs', import.meta.url).href;
const identityUrl = new URL('../../packages/gozar-node/process-identity.mjs', import.meta.url).href;
const context = { now: Date.now, configuration: async () => null, probe: async () => ({ ok:true }), verifyChallenge: async () => ({ status:'verified' }) };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const absent = file => assert.rejects(lstat(file), { code:'ENOENT' });
const listen = (server, endpoint) => new Promise((resolve,reject)=>{
  server.once('error',reject); server.listen(endpoint,resolve);
});

test('real detached controller and broker use validated short cells under a long durable home', { timeout:60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(),'gz-lh-')), home = join(root,'durable-home-'.repeat(10));
  const unrelated = join(root, 'legacy', 'control.sock'), legacyDir = dirname(unrelated);
  let route, control, broker, client;
  const foreign = net.createServer(socket=>{
    socket.on('error',()=>{}); socket.once('data', input=>{
      const request = JSON.parse(String(input));
      socket.end(JSON.stringify({ ok:request.nonce==='fixture-legacy-nonce' })+'\n');
    });
  });
  const scanController = async () => {
    const attached = join(home,'attached');
    const entries = await readdir(attached).catch(()=>[]);
    for (const name of entries) {
      const saved = await readJson(join(attached,name,'fixture-controller.json')).catch(()=>null);
      if (saved?.pid && saved.startIdentity && await processIdentity(saved.pid)===saved.startIdentity) return saved;
    }
    return null;
  };
  try {
    await mkdir(home,{mode:0o700}); await mkdir(legacyDir,{mode:0o700});
    await listen(foreign, unrelated); await chmod(unrelated,0o600);
    await writeFile(join(legacyDir,'control.json'),JSON.stringify({pid:process.pid,startIdentity:await processIdentity(process.pid),nonce:'fixture-legacy-nonce'}),{mode:0o600});
    assert.deepEqual(await controlAttached(legacyDir,{type:'heartbeat'}),{ok:true});
    assert.ok(Buffer.byteLength(join(home,'control.sock'),'utf8')>103);
    const mod = join(root,'controller.mjs');
    await writeFile(mod, `
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {stubAdapter} from ${JSON.stringify(stubUrl)};
import {processIdentity} from ${JSON.stringify(identityUrl)};
export default async function(){
  const dir=process.argv[3], file=join(dir,'bootstrap.json');
  const bootstrap=JSON.parse(readFileSync(file,'utf8'));
  writeFileSync(join(dir,'fixture-controller.json'),JSON.stringify({pid:process.pid,startIdentity:await processIdentity(process.pid)}),{mode:0o600});
  writeFileSync(file,JSON.stringify({...bootstrap,identity:{instanceId:'fixture',bootId:randomUUID()}}));
  return {adapters:[stubAdapter('stub-a')],effectContext:()=>({}),validation:'none',
    readContext:{now:Date.now,configuration:async()=>null,probe:async()=>({ok:true}),verifyChallenge:async()=>({status:'verified'})}};
}
`);
    const tokens=tokenStubs(), q=query({home,usage:{kind:'attached'}});
    const {token}=await tokens.issue({home,binding:tokens.consentBinding(q,home,'disc-stub-a'),grant:{adapterId:'stub-a',planDigest:'plan-stub-a-'+q.target,observedResource:'res-stub-a'}});
    route=await openAttachedRoute({...q,approval:{candidateToken:token,disclosureRevision:'disc-stub-a'},wait:'verified'},
      {adapters:[stubAdapter('stub-a')],redeem:tokens.redeem,consentBinding:tokens.consentBinding,platform:'linux',readContext:context,controllerModule:mod,startTimeoutMs:15000,heartbeatMs:200,leaseExpiryMs:1500});
    const directory=join(home,'attached',route.handle.id);
    control=await readJson(join(directory,'control.json'));
    assert.ok(control.runtimeSocket?.path);
    assert.ok(Buffer.byteLength(control.runtimeSocket.path,'utf8')<=103);
    assert.equal((await controlAttached(directory,{type:'status',generation:route.handle.generation,handleId:route.handle.id})).view.handle.id,route.handle.id);
    let opened=false;
    await assert.rejects(controlAttached(directory,{type:'heartbeat'},1000,{readControl:async()=>JSON.stringify({...control,runtimeSocket:null}),connect:()=>{opened=true;throw new Error('unexpected dial');}}),{code:'invalid_input'});
    assert.equal(opened,false);
    const closed=await closeAttachedRoute({home,handle:route.handle});
    assert.equal(closed.cleanup.state,'confirmed');
    await absent(dirname(control.runtimeSocket.path));
    assert.equal((await closeAttachedRoute({home,handle:route.handle})).cleanup.state,'confirmed','repeat close retains confirmed terminal cleanup');

    const identity={instanceId:'fixture',bootId:'first'};
    broker=await startEmbeddingBroker({home,identity,services:{readConfiguration:async args=>({fixture:args.providerId})},
      dispatchEffect:async effect=>({fixture:effect.kind})});
    const descriptor=await broker.registerController({identity});
    assert.equal(descriptor.socketPath,descriptor.runtimeSocket.path);
    assert.ok(Buffer.byteLength(descriptor.socketPath,'utf8')<=103);
    client=await connectEmbeddingBroker({descriptor,identity});
    assert.deepEqual(await client.readConfiguration({providerId:'fixture-provider'}),{fixture:'fixture-provider'});
    assert.deepEqual(await client.dispatchEffect({kind:'fixture-effect'}),{fixture:'fixture-effect'});
    await assert.rejects(connectEmbeddingBroker({descriptor:{...descriptor,runtimeSocket:null},identity}),{code:'secret_backend_unavailable'});
    await broker.close(); await absent(dirname(descriptor.socketPath));
    assert.deepEqual(await controlAttached(legacyDir,{type:'heartbeat'}),{ok:true},'unrelated listener was left running');
  } finally {
    client?.close();
    await broker?.close().catch(()=>{});
    if (route) await closeAttachedRoute({ home, handle:route.handle }).catch(()=>{});
    const live = await scanController();
    if (live) {
      try{process.kill(live.pid,'SIGKILL');}catch{}
      for(let i=0;i<50&&await processIdentity(live.pid)===live.startIdentity;i++)await sleep(20);
    }
    if(foreign.listening)await new Promise(resolve=>foreign.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
