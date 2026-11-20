// Short, private IPC endpoint allocation. Durable state and route authority stay in the durable home.
import {AsyncLocalStorage} from 'node:async_hooks';
import {chmod,lstat,mkdtemp,realpath,rmdir} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';

const MAX_SOCKET_BYTES=103;
const PREFIX='gz-';
const SOCKET_NAME='broker.sock';
const factorySockets=new AsyncLocalStorage();

function invalidRoot(message,cause){
 return Object.assign(new Error(message,{cause}),{code:'invalid_input'});
}
export function validateSocketDirectory(value){
 if(value===undefined)return;
 if(typeof value!=='string'||!isAbsolute(value)||value.includes('\0'))throw invalidRoot('socketDirectory must be an absolute path');
 return resolve(value);
}

export function withRuntimeSockets(socketDirectory,run){
 return factorySockets.run({socketDirectory},run);
}

export function currentRuntimeSocketDirectory(){
 return validateSocketDirectory(factorySockets.getStore()?.socketDirectory);
}


// A private final directory is insufficient if an untrusted ancestor can be renamed.
async function checkAncestors(parent,uid){
 for(let path=dirname(parent);;path=dirname(path)){
  const state=await lstat(path);
  const trustedOwner=state.uid===0||state.uid===uid;
  const trustedSticky=state.uid===0&&(state.mode&0o1000)!==0;
  if(!state.isDirectory()||!trustedOwner||((state.mode&0o022)!==0&&!trustedSticky)){
   throw invalidRoot('socketDirectory is below an untrusted directory');
  }
  if(path===dirname(path))return;
 }
}

const pendingRetirement=new Set();
const mode=(entry,bits)=>(entry.mode&0o7777n)===bits;
const entry=path=>lstat(path,{bigint:true}).catch(error=>{
 if(error.code!=='ENOENT')throw error;
 return null;
});
const identity=stat=>Object.freeze({dev:String(stat.dev),ino:String(stat.ino)});
const matches=(stat,id)=>stat!==null&&String(stat.dev)===id.dev&&String(stat.ino)===id.ino;
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const validIdentity=value=>!!value&&decimal(value.dev)&&decimal(value.ino);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const validSocketPath=path=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&
 !path.includes('\0')&&Buffer.byteLength(path,'utf8')<=MAX_SOCKET_BYTES&&
 basename(path)===SOCKET_NAME&&/^gz-[A-Za-z0-9]{6}$/.test(basename(dirname(path)));

async function checkParent(parent,uid){
 if(await realpath(parent)!==parent)throw invalidRoot('socketDirectory must not contain symlinks');
 const stat=await entry(parent);
 const privateOwner=stat?.uid===BigInt(uid)&&mode(stat,0o700n);
 const sharedSticky=stat?.uid===0n&&(stat.mode&0o1000n)!==0n&&(stat.mode&0o003n)===0o003n;
 if(!stat?.isDirectory()||(!privateOwner&&!sharedSticky))
  throw invalidRoot('socketDirectory must be private and owned by this user or a root-owned sticky temporary directory');
 await checkAncestors(parent,uid);
}

export async function resolveRuntimeSocket(record,{legacyPath}){
 if(!own(record,'runtimeSocket'))return {kind:'legacy',path:legacyPath};
 const descriptor=record.runtimeSocket;
 if(!descriptor||descriptor.version!==1||!validSocketPath(descriptor.path)||
    !validIdentity(descriptor.root)||!validIdentity(descriptor.socket))
  throw invalidRoot('Invalid runtime socket descriptor');
 const {path,root,socket}=descriptor;
 const uid=process.getuid?.();
 if(uid===undefined)throw invalidRoot('Private runtime sockets require a Unix user identity');
 const directory=dirname(path);
 try{
  await checkParent(dirname(directory),uid);
  const dir=await entry(directory);
  if(!dir?.isDirectory()||dir.uid!==BigInt(uid)||!mode(dir,0o700n)||!matches(dir,root))
   throw invalidRoot('Runtime socket directory does not match its descriptor');
  const endpoint=await entry(path);
  if(!endpoint?.isSocket()||endpoint.uid!==BigInt(uid)||!mode(endpoint,0o600n)||!matches(endpoint,socket))
   throw invalidRoot('Runtime socket entry does not match its descriptor');
 }catch(error){
  if(error.code==='invalid_input')throw error;
  throw invalidRoot('Runtime socket identity unavailable',error);
 }
 return {kind:'bound',path};
}

export function retryPendingRuntimeSockets(){
 return Promise.all([...pendingRetirement].map(endpoint=>endpoint.retire()));
}

export async function allocateRuntimeSocket(directory=factorySockets.getStore()?.socketDirectory){
 const configured=validateSocketDirectory(directory);
 const uid=process.getuid?.();
 if(uid===undefined)throw invalidRoot('Private runtime sockets require a Unix user identity');
 let parent;
 try{
  parent=configured??await realpath('/tmp');
  await checkParent(parent,uid);
  if(!validSocketPath(join(parent,PREFIX+'XXXXXX',SOCKET_NAME)))
   throw invalidRoot('socketDirectory is too long for a portable Unix socket path');
 }catch(error){
  if(error.code==='invalid_input')throw error;
  throw invalidRoot('socketDirectory is not usable for a private runtime socket',error);
 }
 let root;
 try{root=await mkdtemp(join(parent,PREFIX));}
 catch(error){throw invalidRoot('socketDirectory cannot allocate a private runtime directory',error);}
 const path=join(root,SOCKET_NAME);
 const rootEntry=await entry(root);
 if(!rootEntry?.isDirectory()||rootEntry.uid!==BigInt(uid)||!mode(rootEntry,0o700n)||!validSocketPath(path))
  throw invalidRoot('Could not confirm the private runtime socket directory');
 const rootIdentity=identity(rootEntry);
 let server,boundIdentity,retiring,bindInFlight;
 let listenerRetired=true,directoryAbsent=false,retirementRequested=false;
 const rootStatus=async()=>{
  const current=await entry(root);
  if(!current)return 'absent';
  return current.isDirectory()&&current.uid===BigInt(uid)&&mode(current,0o700n)&&
   matches(current,rootIdentity)?'owned':'mismatch';
 };
 const status=(reason)=>reason
  ?{state:'unconfirmed',reason,listenerRetired,directoryAbsent}
  :{state:'confirmed',listenerRetired,directoryAbsent};

 const bind=nextServer=>{
  if(server||retirementRequested)throw invalidRoot('Runtime endpoint is single-use');
  server=nextServer;
  bindInFlight=(async()=>{
   if(await rootStatus()!=='owned')throw invalidRoot('Runtime socket directory changed before bind');
   try{
    await new Promise((resolve,reject)=>{
     const fail=error=>{server.off('listening',ready);reject(error);};
     const ready=()=>{server.off('error',fail);resolve();};
     server.once('error',fail);server.once('listening',ready);
     try{server.listen(path);}catch(error){server.off('error',fail);server.off('listening',ready);reject(error);}
    });
   }finally{listenerRetired=!server.listening;}
   const socket=await entry(path);
   if(!socket?.isSocket()||socket.uid!==BigInt(uid)||await rootStatus()!=='owned')
    throw invalidRoot('Could not confirm runtime socket ownership after bind');
   boundIdentity=identity(socket);
   await chmod(path,0o600);
   const descriptor=Object.freeze({version:1,path,root:rootIdentity,socket:boundIdentity});
   await resolveRuntimeSocket({runtimeSocket:descriptor},{});
   if(retirementRequested)throw invalidRoot('Runtime endpoint retirement already requested');
   return descriptor;
  })();
  return bindInFlight;
 };

 const retireOnce=async()=>{
  if(bindInFlight)await bindInFlight.catch(()=>{});
  if(directoryAbsent&&listenerRetired)return status();
  if(!listenerRetired){
   server.unref();
   if(!boundIdentity)return status('identity-unavailable');
   let current;
   try{
    await checkParent(parent,uid);
    if(await rootStatus()!=='owned')return status('entry-mismatch');
    current=await entry(path);
   }catch{return status('identity-unavailable');}
   if(!current?.isSocket()||current.uid!==BigInt(uid)||!matches(current,boundIdentity))
    return status('entry-mismatch');
   try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
   catch{return status('server-close-failed');}
   listenerRetired=true;
  }
  try{
   const rootState=await rootStatus();
   if(rootState==='mismatch')return status('entry-mismatch');
   if(rootState==='owned'){
    try{await rmdir(root);}
    catch(error){if(error.code!=='ENOENT')return status('directory-retained');}
   }
   directoryAbsent=await rootStatus()==='absent';
   return status(directoryAbsent?undefined:'directory-retained');
  }catch{return status('identity-unavailable');}
 };
 const endpoint={path,bind,close:retire,cleanup:retire,retire};
 function retire(){
  retirementRequested=true;
  if(!retiring)retiring=retireOnce().then(result=>{
   if(result.state==='confirmed')pendingRetirement.delete(endpoint);
   else pendingRetirement.add(endpoint);
   return result;
  }).finally(()=>{retiring=undefined;});
  return retiring;
 }
 return endpoint;
}
