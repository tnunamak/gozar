import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {scratch} from './route-schema-check.mjs';
test('the public host cannot read legacy minimal proof as publication but can still stop that exact session',async t=>{
 const home=await scratch(t),directory=join(home,'port-18765'),sessionId='legacy-session';await mkdir(directory,{mode:0o700});
 await writeFile(join(directory,'bootstrap.json'),JSON.stringify({adapterId:'legacy-fixture',adapters:[{id:'legacy-fixture'}],sessionId}),{mode:0o600});
 await writeFile(join(directory,'control.json'),JSON.stringify({pid:process.pid,startIdentity:await processIdentity(process.pid),nonce:'private-fixture'}),{mode:0o600});
 const commands=[];const server=net.createServer(socket=>socket.on('data',bytes=>{const message=JSON.parse(bytes);assert.equal(message.nonce,'private-fixture');commands.push(message.command.type);socket.end(JSON.stringify({snapshot:{sessionId,phase:'stopped',resources:[],published:null},localCleanupFailures:[]})+'\n');}));
 await new Promise(resolve=>server.listen(join(directory,'control.sock'),resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const api=createGozar(),ref={home,handle:{kind:'session',id:`port-18765:${sessionId}`,generation:1}};
 await assert.rejects(api.routeStatus(ref),{code:'unsupported'});assert.deepEqual(commands,[],'no health or proof command reaches the legacy runtime');
 const stopped=await api.closeRoute({...ref,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');assert.equal(stopped.published,null);assert.deepEqual(commands,['stop']);
});
