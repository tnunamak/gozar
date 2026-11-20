// Short, private IPC endpoint allocation. Durable state and route authority stay in the durable home.
import {AsyncLocalStorage} from 'node:async_hooks';
import {chmod,lstat,mkdtemp,realpath,rmdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';

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

export async function allocateRuntimeSocket(directory=factorySockets.getStore()?.socketDirectory){
 const configured=validateSocketDirectory(directory);
 const uid=process.getuid?.();
 if(uid===undefined)throw invalidRoot('Private runtime sockets require a Unix user identity');
 let parent;
 try{
  parent=configured??await realpath('/tmp');
  const actual=await realpath(parent);
  if(actual!==parent)throw invalidRoot('socketDirectory must not contain symlinks');
  const state=await lstat(parent);
  const privateOwner=state.uid===uid&&(state.mode&0o777)===0o700;
  const sharedSticky=state.uid===0&&(state.mode&0o1000)!==0&&(state.mode&0o003)===0o003;
  if(!state.isDirectory()||(!privateOwner&&!sharedSticky))throw invalidRoot('socketDirectory must be private and owned by this user or a root-owned sticky temporary directory');
  await checkAncestors(parent,uid);
  const sample=join(parent,PREFIX+'XXXXXX',SOCKET_NAME);
  if(Buffer.byteLength(sample,'utf8')>MAX_SOCKET_BYTES)throw invalidRoot('socketDirectory is too long for a portable Unix socket path');
 }catch(error){
  if(error.code==='invalid_input')throw error;
  throw invalidRoot('socketDirectory is not usable for a private runtime socket',error);
 }
 let root;
 try{root=await mkdtemp(join(parent,PREFIX));}
 catch(error){throw invalidRoot('socketDirectory cannot allocate a private runtime directory',error);}
 const state=await lstat(root);
 const path=join(root,SOCKET_NAME);
 const sameEntry=(first,next)=>first.dev===next.dev&&first.ino===next.ino&&next.uid===uid;
 const entry=async path=>lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
 const rootIsOurs=async()=>{
  const current=await entry(root);
  return current?.isDirectory()&&(current.mode&0o777)===0o700&&sameEntry(state,current);
 };
 const cleanup=async()=>{
  if(!await rootIsOurs())return;
  // Never recurse: preserve a directory that still has any unexpected entries.
  await rmdir(root).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
 };
 if(!state.isDirectory()||state.uid!==uid||(state.mode&0o777)!==0o700||Buffer.byteLength(path,'utf8')>MAX_SOCKET_BYTES){
  const error=invalidRoot('Could not allocate a private runtime socket directory within the path budget');
  await cleanup().catch(()=>{});
  throw error;
 }
 let boundEntry;
 let boundServer;
 const bind=async server=>{
  if(boundServer)throw invalidRoot('Runtime endpoint is single-use');
  boundServer=server;
  if(!await rootIsOurs())throw invalidRoot('Runtime socket directory changed before bind');
  await new Promise((resolve,reject)=>{
   const fail=error=>{server.off('listening',ready);reject(error);};
   const ready=()=>{server.off('error',fail);resolve();};
   server.once('error',fail);
   server.once('listening',ready);
   try{server.listen(path);}catch(error){server.off('error',fail);server.off('listening',ready);reject(error);}
  });
  const current=await entry(path);
  if(!current?.isSocket()||current.uid!==uid||!await rootIsOurs()){
   throw invalidRoot('Could not confirm runtime socket ownership after bind');
  }
  boundEntry=current;
  await chmod(path,0o600);
 };
 const close=async()=>{
  if(boundServer?.listening){
   // Node removes the socket path on close. Do not ask it to close a path
   // whose allocation or bound inode cannot be confirmed.
   boundServer.unref();
   if(!boundEntry||!await rootIsOurs())return;
   const current=await entry(path);
   if(!current?.isSocket()||!sameEntry(boundEntry,current))return;
   await new Promise((resolve,reject)=>boundServer.close(error=>error?reject(error):resolve()));
  }
  await cleanup();
 };
 return {path,bind,close,cleanup};
}
