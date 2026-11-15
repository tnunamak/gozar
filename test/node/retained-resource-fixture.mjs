import net from 'node:net';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rename,chmod,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';

// Test-only parent-owned provider. Return names: registry {manifest,root}, modulePath,
// appTarget, foreignTarget, controls {refuseRemoval,wrongNonce}, observations(),
// isListening(origin), close({preserveEvidence=false}). close owns only this fixture's
// sockets/directories; callers MUST reap their saved children before calling close.
// No catalog/approval has occurred when the cloned definition/module is finalized.
const listen = server => new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
});
function track(server) {
  const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
  return async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));};
}
const address=server=>'127.0.0.1:'+server.address().port;
export async function isListening(origin) {
  const endpoint=new URL(origin.includes('://')?origin:'tcp://'+origin);
  return new Promise(resolve=>{
    const socket=net.connect({host:endpoint.hostname,port:Number(endpoint.port)});
    const done=value=>{socket.destroy();resolve(value);};
    socket.setTimeout(750,()=>done(false));socket.once('error',()=>done(false));socket.once('connect',()=>done(true));
  });
}
export async function createRetainedResourceFixture({timeoutMs=1500}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>5000)throw new Error('fixture timeout range');
  const root=await mkdtemp(join(tmpdir(),'grf-'));await chmod(root,0o700);
  const rootIdentity=await lstat(root),token=randomBytes(32).toString('hex'),id='retained-'+randomBytes(8).toString('hex');
  const resources=new Map(),effects=[];let refusing=false,wrong=false,allocations=0,attemptedRemovals=0,physicalRemovals=0,closing=false;
  const closers=[];
  const echo=()=>net.createServer({allowHalfOpen:true},socket=>socket.pipe(socket));
  const app=echo(),foreign=echo();closers.push(track(app),track(foreign));
  const exact=(a,b)=>a?.schemaVersion===b.schemaVersion&&a?.adapterId===b.adapterId&&a?.resourceKey===b.resourceKey&&a?.generation===b.generation&&a?.origin===b.origin&&a?.identity===b.identity;
  const failure=()=>Object.assign(new Error('fixture effect refused'),{code:'provider_unavailable'});
  const operate=async message=>{
    if(closing)throw failure();
    if(message.op==='create'){
      const {plan,generation,operationId}=message;
      if(!plan||typeof plan.resourceKey!=='string'||!plan.resourceKey.startsWith(id+':')||!Number.isSafeInteger(generation)||generation<1)throw failure();
      const endpoint=new URL('tcp://'+plan.effects?.[0]?.target);
      if(endpoint.hostname!=='127.0.0.1'||!endpoint.port)throw failure();
      if(resources.has(plan.resourceKey))throw failure();
      const server=net.createServer({allowHalfOpen:true},socket=>{
        socket.setTimeout(timeoutMs,()=>socket.destroy());
        if(wrong){socket.once('data',()=>socket.end('wrong\n'));return;}
        const upstream=net.connect({host:'127.0.0.1',port:Number(endpoint.port)});
        upstream.setTimeout(timeoutMs,()=>upstream.destroy());socket.setTimeout(timeoutMs,()=>socket.destroy());
        upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
        socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());
        socket.pipe(upstream).pipe(socket);
      });
      const stop=track(server);await listen(server);
      const receipt={schemaVersion:1,adapterId:id,resourceKey:plan.resourceKey,generation,operationId:operationId??null,
        identity:randomBytes(16).toString('hex'),readback:plan.readback,origin:'tcp://'+address(server)};
      resources.set(plan.resourceKey,{server,stop,receipt,present:true});allocations++;effects.push({event:'created',resourceKey:plan.resourceKey,generation});
      return receipt;
    }
    if(message.op==='observe'){
      const resource=resources.get(message.resourceKey);
      return {present:!!resource?.present&&resource.server.listening,resourceKey:message.resourceKey,identity:resource?.receipt.identity??null,revision:resource?String(resource.receipt.generation):null};
    }
    if(message.op==='remove'){
      attemptedRemovals++;const resource=resources.get(message.receipt?.resourceKey);
      if(!resource||!exact(message.receipt,resource.receipt)){effects.push({event:'foreign-removal-refused'});return {removed:false,debt:{code:'foreign_resource',message:'Exact owned receipt required'}};}
      if(!resource.present)return {removed:true,debt:null};
      if(refusing){effects.push({event:'removal-refused'});return {removed:false,debt:{code:'fixture_refusal',message:'Persistent fixture removal refusal'}};}
      await resource.stop();resource.present=false;physicalRemovals++;effects.push({event:'physically-removed',resourceKey:resource.receipt.resourceKey});
      return {removed:true,debt:null};
    }
    throw failure();
  };
  // Serialize effects; concurrent remove retries cannot double-count physical close.
  let tail=Promise.resolve();
  const rpc=http.createServer((req,res)=>{
    const deadline=setTimeout(()=>req.destroy(),timeoutMs);
    res.once('close',()=>clearTimeout(deadline));
    req.setTimeout(timeoutMs,()=>req.destroy());
    if(req.method!=='POST'||req.url!=='/'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return;}
    let bytes=0,body='';req.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)req.destroy();else body+=chunk;});
    req.on('error',()=>{});req.on('end',()=>{
      let message;try{message=JSON.parse(body);}catch{res.writeHead(400);res.end();return;}
      const work=tail.then(()=>operate(message));tail=work.catch(()=>{});
      work.then(value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({value}));},()=>{res.writeHead(409);res.end('{"error":"fixture effect refused"}');});
    });
  });
  rpc.headersTimeout=timeoutMs;rpc.requestTimeout=timeoutMs;closers.push(track(rpc));
  const close=async({preserveEvidence=false}={})=>{
    closing=true;await tail;for(const resource of resources.values())await resource.stop();
    for(const stop of closers)await stop();
    if(!preserveEvidence){const current=await lstat(root);if(!current.isDirectory()||current.isSymbolicLink()||current.ino!==rootIdentity.ino||current.dev!==rootIdentity.dev)throw new Error('fixture scratch identity changed');await rm(root,{recursive:true,force:false});}
  };
  try{
    await listen(app);await listen(foreign);await listen(rpc);
    const registry=await fakeRegistry({id,kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',dir:root});
    const folder=join(root,'providers',id),modulePath=join(folder,'index.mjs');
    await rename(modulePath,join(folder,'plain.mjs'));
    const definition=JSON.parse(await readFile(join(folder,'definition.json'),'utf8'));
    definition.adapter.disclosure.text='Local test-only parent-owned listener; survives controller death. No provider acceptance evidence.';
    definition.adapter.capabilities.address.scope='local parent-owned fixture';
    await writeFile(join(folder,'definition.json'),JSON.stringify(definition),{mode:0o600});
    await writeFile(join(folder,'fixture.json'),JSON.stringify({port:rpc.address().port,token,timeoutMs}),{mode:0o600});
    await writeFile(modulePath,WRAPPER,{mode:0o600});
    return {registry:{manifest:registry.manifest,root},modulePath,appTarget:address(app),foreignTarget:address(foreign),
      controls:{refuseRemoval:value=>{refusing=!!value;},wrongNonce:value=>{wrong=!!value;}},
      observations:()=>({allocations,attemptedRemovals,physicalRemovals,resources:[...resources.values()].map(r=>({receipt:structuredClone(r.receipt),listening:r.server.listening,present:r.present})),effects:structuredClone(effects)}),
      isListening,close};
  }catch(error){await close({preserveEvidence:true});throw error;}
}
const WRAPPER = `
import plain from './plain.mjs';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));
const rpc=message=>new Promise((resolve,reject)=>{
  const body=JSON.stringify(message);
  const req=http.request({host:'127.0.0.1',port:config.port,path:'/',method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
    let bytes=0,text='';res.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)res.destroy();else text+=chunk;});
    res.on('error',()=>reject(new Error('fixture RPC failed')));
    res.on('end',()=>{try{if(res.statusCode!==200)throw 0;resolve(JSON.parse(text).value);}catch{reject(new Error('fixture RPC failed'));}});
  });
  const deadline=setTimeout(()=>req.destroy(),config.timeoutMs);
  req.once('close',()=>clearTimeout(deadline));
  req.setTimeout(config.timeoutMs,()=>req.destroy());req.on('error',()=>reject(new Error('fixture RPC failed')));req.end(body);
});
export default {...plain,
  async create(ctx,plan){await ctx.assertGeneration();return rpc({op:'create',plan,generation:ctx.generation,operationId:ctx.operationId??null});},
  async observe(ctx,request){const plan=await plain.plan(ctx,request);return rpc({op:'observe',resourceKey:plan.resourceKey});},
  async remove(ctx,receipt){await ctx.assertGeneration();return rpc({op:'remove',receipt});},
  async prepareProof(ctx,request,attempt){
    const prepared=await plain.prepareProof(ctx,request,attempt);
    return {...prepared,async verify(input){
      if(input.attempt.id!==attempt.id||input.attempt.nonce!==attempt.nonce||input.attempt.deadlineMs!==attempt.deadlineMs||attempt.signal.aborted||Date.now()>=attempt.deadlineMs||input.receipt.adapterId!==plain.id||input.receipt.origin!==input.origin)throw new Error('fixture proof binding refused');
      const result=await prepared.verify(input);
      if(attempt.signal.aborted||Date.now()>=attempt.deadlineMs)return {...result,status:'unverified',checkedAt:null};
      return {...result,validUntil:new Date(Math.min(attempt.deadlineMs,Date.parse(result.validUntil))).toISOString()};
    }};
  }
};
`;
