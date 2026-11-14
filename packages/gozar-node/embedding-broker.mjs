// Host-owned authenticated, boot-bound resolver. Descriptor contains authority, never credentials.
import net from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {chmod,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome} from './service-state.mjs';
import {embeddingError} from './embedding-services.mjs';
const allowed=new Set(['ping','dispatchEffect','readConfiguration','resolveConfiguration','registerConfigurationUse','releaseConfigurationUse']);
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
export async function startEmbeddingBroker({services,home,identity,onLoss=()=>{},dispatchEffect}){
 home=await canonicalHome(home,true);identity??=await services.resolveIdentity({home});
 const descriptor={socketPath:join(home,`resolver-${randomBytes(6).toString('hex')}.sock`),token:randomBytes(32).toString('hex'),...identity};
 const sockets=new Set();let closed=false,registered=false;
 const admittedBoots=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.setEncoding('utf8');let buffer='';let queue=Promise.resolve();
  socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);if(!closed)onLoss(embeddingError('secret_backend_unavailable'));});
  socket.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>1024*1024){socket.destroy();return;}
   let cut;while((cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);queue=queue.then(async()=>{
    let request;try{request=JSON.parse(line);}catch{socket.destroy();return;}
    if(!same(request.token,descriptor.token)||request.bootId!==identity.bootId||request.instanceId!==identity.instanceId||!allowed.has(request.method)){socket.end(JSON.stringify({id:request.id,error:'secret_backend_unavailable'})+'\n');return;}
    try{if(request.method==='dispatchEffect'&&!dispatchEffect)throw embeddingError('unsupported');
     const result=request.method==='ping'?{ready:true}:request.method==='dispatchEffect'?await dispatchEffect(request.args):await services[request.method]({...request.args,home});socket.write(JSON.stringify({id:request.id,result})+'\n');}
    catch(e){socket.write(JSON.stringify({id:request.id,error:['unsupported','configuration_stale','configuration_in_use','secret_backend_locked'].includes(e.code)?e.code:'secret_backend_unavailable'})+'\n');}
   }).catch(()=>socket.destroy());}
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(descriptor.socketPath,resolve);});await chmod(descriptor.socketPath,0o600);
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
   identity={...nextIdentity};Object.assign(descriptor,identity,{token:randomBytes(32).toString('hex')});
   onLoss(embeddingError('secret_backend_unavailable'));return {...descriptor};
  },async close(){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await unlink(descriptor.socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});onLoss(embeddingError('secret_backend_unavailable'));}};
}
export async function connectEmbeddingBroker({descriptor,identity,onLoss=()=>{}}){
 if(!identity||identity.bootId!==descriptor.bootId||identity.instanceId!==descriptor.instanceId)throw embeddingError('secret_backend_unavailable');
 const socket=net.createConnection(descriptor.socketPath);socket.setEncoding('utf8');let buffer='',sequence=0,lost=false;const pending=new Map();
 const loss=()=>{if(lost)return;lost=true;const e=embeddingError('secret_backend_unavailable');for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();onLoss(e);};
 socket.on('error',loss);socket.on('close',loss);
 socket.on('data',chunk=>{buffer+=chunk;let cut;while((cut=buffer.indexOf('\n'))>=0){let response;try{response=JSON.parse(buffer.slice(0,cut));}catch{socket.destroy();return;}buffer=buffer.slice(cut+1);const p=pending.get(response.id);if(p){clearTimeout(p.timer);pending.delete(response.id);response.error?p.reject(embeddingError(response.error)):p.resolve(response.result);}}});
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(embeddingError('secret_backend_unavailable')));});
 const api={close:()=>socket.destroy()};for(const method of allowed)api[method]=args=>new Promise((resolve,reject)=>{
  if(lost){reject(embeddingError('secret_backend_unavailable'));return;}const id=++sequence;
  const timer=setTimeout(()=>{pending.delete(id);reject(embeddingError('secret_backend_unavailable'));socket.destroy();},10000);timer.unref();pending.set(id,{resolve,reject,timer});socket.write(JSON.stringify({id,token:descriptor.token,...identity,method,args})+'\n');
 });try{await api.ping({});}catch(e){socket.destroy();throw e;}delete api.ping;return api;
}
