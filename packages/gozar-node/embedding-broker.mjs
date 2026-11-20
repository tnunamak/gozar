// Host-owned authenticated, boot-bound resolver. Descriptor contains authority, never credentials.
import net from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {canonicalHome} from './service-state.mjs';
import {embeddingError} from './embedding-services.mjs';
import {allocateRuntimeSocket,resolveRuntimeSocket} from './runtime-sockets.mjs';
const allowed=new Set(['ping','dispatchEffect','acknowledgeOrigin','readConfiguration','resolveConfiguration','registerConfigurationUse','releaseConfigurationUse']);
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
export async function startEmbeddingBroker({services,home,identity,onLoss=()=>{},dispatchEffect,acknowledgeOrigin}){
 home=await canonicalHome(home,true);identity??=await services.resolveIdentity({home});
 const endpoint=await allocateRuntimeSocket();
 let descriptor;
 const sockets=new Set();let admitting=false,closed=false,registered=false;
 const admittedBoots=new Set();
 const server=net.createServer(socket=>{
  if(!admitting){socket.destroy();return;}
  sockets.add(socket);socket.setEncoding('utf8');let buffer='';let queue=Promise.resolve();
  socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);if(!closed)onLoss(embeddingError('secret_backend_unavailable'));});
  socket.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>1024*1024){socket.destroy();return;}
   let cut;while((cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);
   let request;try{request=JSON.parse(line);}catch{socket.destroy();return;}
   const handle=async()=>{
    if(!admitting||socket.destroyed){socket.destroy();return;}
    if(!same(request.token,descriptor.token)||request.bootId!==identity.bootId||request.instanceId!==identity.instanceId||!allowed.has(request.method)){socket.end(JSON.stringify({id:request.id,error:'secret_backend_unavailable'})+'\n');return;}
    try{if(request.method==='dispatchEffect'&&!dispatchEffect)throw embeddingError('unsupported');
     if(request.method==='acknowledgeOrigin'&&!acknowledgeOrigin)throw embeddingError('unsupported');
     const result=request.method==='ping'?{ready:true}:request.method==='dispatchEffect'?await dispatchEffect(request.args):
      request.method==='acknowledgeOrigin'?await acknowledgeOrigin({...request.args,home}):await services[request.method]({...request.args,home});socket.write(JSON.stringify({id:request.id,result})+'\n');}
    catch(e){socket.write(JSON.stringify({id:request.id,error:['unsupported','configuration_stale','configuration_in_use','secret_backend_locked'].includes(e.code)?e.code:'secret_backend_unavailable'})+'\n');}
   };
   // The acknowledgment is a host-side notification with the controller's own bound. It never occupies the
   // per-socket request queue, so a held or hung host handler cannot block the controller's later
   // configuration, effect or cleanup calls on this channel.
   if(request.method==='acknowledgeOrigin')void handle().catch(()=>socket.destroy());
   else queue=queue.then(handle).catch(()=>socket.destroy());}
  });
 });
 const stop=()=>{
  admitting=false;
  for(const socket of sockets)socket.destroy();
  return endpoint.retire();
 };
 let runtimeSocket;
 try{
  runtimeSocket=await endpoint.bind(server);
  descriptor={...identity,socketPath:runtimeSocket.path,runtimeSocket,token:randomBytes(32).toString('hex')};
  admitting=true;
 }catch(error){
  closed=true;
  const cleanup=await stop().catch(()=>({state:'unconfirmed',reason:'cleanup-failed',listenerRetired:false,directoryAbsent:false}));
  // Cleanup is supplemental; the primary startup error retains its identity.
  try{Object.defineProperty(error,'runtimeSocketCleanup',{value:cleanup,configurable:true});}catch{}
  throw error;
 }
 return {descriptor,async registerController({identity:nextIdentity}={}){
   if(closed)throw embeddingError('secret_backend_unavailable');
   if(!registered){
    nextIdentity??=identity;
    if(nextIdentity.instanceId!==identity.instanceId||nextIdentity.bootId!==identity.bootId||
       typeof identity.bootId!=='string'||!identity.bootId)throw embeddingError('secret_backend_unavailable');
    registered=true;admittedBoots.add(identity.bootId);
    return {...descriptor};
   }
   if(!nextIdentity||nextIdentity.instanceId!==identity.instanceId||
      typeof nextIdentity.bootId!=='string'||!nextIdentity.bootId||
      admittedBoots.has(nextIdentity.bootId))throw embeddingError('secret_backend_unavailable');
   admittedBoots.add(nextIdentity.bootId);
   for(const socket of sockets)socket.destroy();
   identity={...nextIdentity};Object.assign(descriptor,identity,{socketPath:runtimeSocket.path,runtimeSocket,token:randomBytes(32).toString('hex')});
   onLoss(embeddingError('secret_backend_unavailable'));return {...descriptor};
  },async close(){const notify=!closed;closed=true;try{return await stop();}finally{if(notify)onLoss(embeddingError('secret_backend_unavailable'));}}};
}
export async function connectEmbeddingBroker({descriptor,identity,onLoss=()=>{}}){
 if(!descriptor||!identity||identity.bootId!==descriptor.bootId||identity.instanceId!==descriptor.instanceId)throw embeddingError('secret_backend_unavailable');
 let path;
 try{({path}=await resolveRuntimeSocket(descriptor,{legacyPath:descriptor.socketPath}));}
 catch{throw embeddingError('secret_backend_unavailable');}
 const socket=net.createConnection(path);socket.setEncoding('utf8');let buffer='',sequence=0,lost=false;const pending=new Map();
 const loss=()=>{if(lost)return;lost=true;const e=embeddingError('secret_backend_unavailable');for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();onLoss(e);};
 socket.on('error',loss);socket.on('close',loss);
 socket.on('data',chunk=>{buffer+=chunk;let cut;while((cut=buffer.indexOf('\n'))>=0){let response;try{response=JSON.parse(buffer.slice(0,cut));}catch{socket.destroy();return;}buffer=buffer.slice(cut+1);const p=pending.get(response.id);if(p){clearTimeout(p.timer);pending.delete(response.id);response.error?p.reject(embeddingError(response.error)):p.resolve(response.result);}}});
 try{await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(embeddingError('secret_backend_unavailable')));});}
 catch(error){socket.destroy();throw error;}
 const api={close:()=>socket.destroy()};for(const method of allowed)api[method]=args=>new Promise((resolve,reject)=>{
  if(lost){reject(embeddingError('secret_backend_unavailable'));return;}const id=++sequence;
  const timer=setTimeout(()=>{pending.delete(id);reject(embeddingError('secret_backend_unavailable'));socket.destroy();},10000);timer.unref();pending.set(id,{resolve,reject,timer});socket.write(JSON.stringify({id,token:descriptor.token,...identity,method,args})+'\n');
 });try{await api.ping({});}catch(e){socket.destroy();throw e;}delete api.ping;return api;
}
