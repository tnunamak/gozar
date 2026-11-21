import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {control} from '../../packages/gozar-node/daemon.mjs';
import {controlAttached} from '../../packages/gozar-node/attached-route.mjs';
import {processIdentity} from '../../packages/gozar-node/journal.mjs';

for(const [name,entry] of [['daemon',control],['attached',controlAttached]]) {
 for(const scenario of ['success','malformed','disconnected','timeout','typed reply']) {
  test(name+' controller transport: '+scenario,{timeout:5000},async t=>{
   const directory=await mkdtemp(join(tmpdir(),'synthetic-controller-'));
   t.after(()=>rm(directory,{recursive:true,force:true}));
   const startIdentity=await processIdentity(process.pid);
   assert.ok(startIdentity,'the process belonging to this fixture has an identity');
   await writeFile(join(directory,'bootstrap.json'),JSON.stringify({adapterId:'fixture',adapters:[{id:'fixture',planVersion:1}]}));
   await writeFile(join(directory,'control.json'),JSON.stringify({pid:process.pid,startIdentity,nonce:'fixture-marker'}));
   const sent=[];
   let socket,callback,connected,disposed=0,cleared=0;
   const ready=new Promise(resolve=>{connected=resolve;});
   const call=entry(directory,{type:'observe'},25,{
    connect(path){
     assert.equal(path,join(directory,'control.sock'));
     socket=Object.assign(new EventEmitter(),{write:data=>{sent.push(data);},destroy:()=>{disposed++;}});
     connected();return socket;
    },
    schedule(fn,ms){assert.equal(ms,25);callback=fn;return 'timer';},
    unschedule(id){assert.equal(id,'timer');cleared++;},
   });
   try{
    await Promise.race([ready,call.then(()=>assert.fail('settled before fake connect'))]);
    socket.emit('connect');
    assert.deepEqual(JSON.parse(sent[0]),{nonce:'fixture-marker',command:{type:'observe'},controllerIdentity:{pid:process.pid,startIdentity}});
    assert.ok(sent[0].endsWith('\n'));
    if(scenario==='success'){
     socket.emit('data','{"ok"');
     socket.emit('data',':true}\n');
     assert.deepEqual(await call,{ok:true});
    }else if(scenario==='malformed'){
     socket.emit('data','bad JSON\n');
     await assert.rejects(call,SyntaxError);
    }else if(scenario==='disconnected'){
     const failure=new Error('fixture socket disconnected');
     socket.emit('error',failure);
     await assert.rejects(call,error=>error===failure&&Boolean(error.gone)===(name==='attached'));
    }else if(scenario==='timeout'){
     callback();
     if(name==='attached')await assert.rejects(call,{code:'provider_unavailable'});
     else await assert.rejects(call,/timed out; readiness unknown/);
    }else{
     const error=name==='attached'?{error:{code:'route_conflict',message:'fixture conflict'}}
      :{error:'fixture conflict',code:'route_conflict',nextAction:null};
     socket.emit('data',JSON.stringify(error)+'\n');
     await assert.rejects(call,{code:'route_conflict',message:'fixture conflict'});
    }
    assert.equal(disposed,1);assert.equal(cleared,1);
   }finally{
    callback?.();
    await call.catch(()=>{});
   }
  });
 }
}
