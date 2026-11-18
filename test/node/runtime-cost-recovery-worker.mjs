import {createGozar} from '@tnunamak/gozar';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// A fresh SDK reader process, not a restarted creator/controller.
process.on('message', async message => {
 if(message.type==='stop'){process.disconnect();return;}
 if(message.type!=='read')throw new Error('Unexpected reader command');
 try{
  const {config,home,owner,handle,operationId}=message;
  const api=createGozar(config);
  const listed=await api.listRoutes({home,owner});
  const directory=handle.kind==='attached'?join(home,'attached',handle.id):join(home,handle.id.split(':')[0]);
  const persisted=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
  const bootstrap=JSON.parse(await readFile(join(directory,'bootstrap.json'),'utf8'));
  const key=createHash('sha256').update(JSON.stringify([owner,operationId])).digest('hex');
  const operation=JSON.parse(await readFile(join(home,'operations',key+'.json'),'utf8'));
  process.send({type:'read',id:message.id,pid:process.pid,listed,persisted:persisted.lastView,stateHandle:persisted.handle,
   bootstrap:{id:bootstrap.id,home:bootstrap.home,owner:bootstrap.owner,operationId:bootstrap.operationId,handle:bootstrap.handle},
   operation:{owner:operation.owner,operationId:operation.operationId,handle:operation.view.handle}});
 }catch(error){process.send({type:'failure',id:message.id,code:error.code??null,message:error.message});}
});
process.send({type:'ready',pid:process.pid});
