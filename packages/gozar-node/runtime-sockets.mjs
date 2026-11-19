// Short, private IPC endpoint allocation. Durable state and route authority stay in the durable home.
import {AsyncLocalStorage} from 'node:async_hooks';
import {lstat,mkdtemp,realpath,rmdir} from 'node:fs/promises';
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
 const cleanup=async()=>{
  const current=await lstat(root).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(!current||!current.isDirectory()||current.uid!==uid||current.dev!==state.dev||current.ino!==state.ino)return;
  // Never recurse or unlink arbitrary entries. Node owns its bound endpoint; after server close
  // this removes only our empty directory and preserves any unexpected entries.
  await rmdir(root).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
 };
 if(!state.isDirectory()||state.uid!==uid||(state.mode&0o777)!==0o700||Buffer.byteLength(path,'utf8')>MAX_SOCKET_BYTES){
  await cleanup();
  throw invalidRoot('Could not allocate a private runtime socket directory within the path budget');
 }
 return {path,cleanup};
}
