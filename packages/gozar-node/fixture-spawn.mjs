// A ChildProcess facade for explicit fixture effects. Ownership still uses actual PID birth identity.
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
export function fixtureSpawn(dispatchEffect){
 return (program,args,options={})=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=undefined;
  let handle,stopped=false,closed=false,poll;
  const close=(code=null)=>{if(closed)return;closed=true;clearInterval(poll);child.stdout.end();child.stderr.end();child.emit('exit',code);child.emit('close',code);};
  child.on('error',()=>{});
  child.kill=signal=>{stopped=true;if(handle)void dispatchEffect({kind:'spawn',operation:'close',input:{handle,signal:signal??'SIGTERM'}}).catch(()=>{});return true;};
  Promise.resolve().then(()=>dispatchEffect({kind:'spawn',operation:'run',input:{program,args,longRunning:options.fixtureEffect?.longRunning===true}})).then(result=>{
   if(typeof result?.stdout!=='string'||typeof result?.stderr!=='string'||Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)>1048576||!(result.exitCode===null||Number.isInteger(result.exitCode)))throw new Error('Invalid fixture process observation');
   if(result.exitCode===null){if(typeof result.handle!=='string'||!result.handle||!Number.isSafeInteger(result.pid)||result.pid<1)throw new Error('Fixture process needs an actual owned PID');handle=result.handle;child.pid=result.pid;}
   if(stopped){child.kill('SIGTERM');throw new Error('Fixture process completed after cancellation');}
   child.emit('spawn');setImmediate(()=>{child.stdout.write(result.stdout);child.stderr.write(result.stderr);if(result.exitCode!==null)close(result.exitCode);});
   if(result.exitCode!==null)return;
   let checking=false;poll=setInterval(async()=>{if(checking||closed)return;checking=true;try{const observed=await dispatchEffect({kind:'spawn',operation:'read',input:{handle}});if(observed?.present===false)close(observed.exitCode??0);else if(observed?.present!==true)throw new Error('Fixture process presence is unknown');}catch{child.emit('error',new Error('Fixture process observation failed'));clearInterval(poll);}finally{checking=false;}},250);poll.unref();
  }).catch(()=>{child.emit('error',new Error('The declared fixture process effect failed'));close(null);});
  return child;
 };
}
