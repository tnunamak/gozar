import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {scratch} from './route-schema-check.mjs';
// 0.5.1 closed this record by sending `stop` to the earlier controller's socket. This version never speaks that controller's protocol (see legacy-session-record.test.mjs):
// the record is history, it is never read as publication, no command reaches the socket, and a close with no journal to recover from is cleanup debt that keeps the record.
test('the public host cannot read a legacy minimal record as publication, sends the earlier controller no command, and reports its close as cleanup debt',async t=>{
 const home=await scratch(t),directory=join(home,'port-18765'),sessionId='legacy-session';await mkdir(directory,{mode:0o700});
 await writeFile(join(directory,'bootstrap.json'),JSON.stringify({adapterId:'legacy-fixture',adapters:[{id:'legacy-fixture'}],sessionId}),{mode:0o600});
 await writeFile(join(directory,'control.json'),JSON.stringify({pid:process.pid,startIdentity:await processIdentity(process.pid),nonce:'private-fixture'}),{mode:0o600});
 const commands=[];const server=net.createServer(socket=>socket.on('data',bytes=>{const message=JSON.parse(bytes);assert.equal(message.nonce,'private-fixture');commands.push(message.command.type);socket.end(JSON.stringify({snapshot:{sessionId,phase:'stopped',resources:[],published:null},localCleanupFailures:[]})+'\n');}));
 await new Promise(resolve=>server.listen(join(directory,'control.sock'),resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const api=createGozar(),ref={home,handle:{kind:'session',id:`port-18765:${sessionId}`,generation:1}};
 await assert.rejects(api.routeStatus(ref),{code:'route_not_found'});assert.deepEqual(commands,[],'no health or proof command reaches the legacy runtime');
 await assert.rejects(api.closeRoute({...ref,mode:'remove'}),{code:'cleanup_debt'});assert.deepEqual(commands,[],'close sends the earlier controller nothing');
 assert.ok(await readFile(join(directory,'bootstrap.json')),'the recorded session stays as evidence');
});
