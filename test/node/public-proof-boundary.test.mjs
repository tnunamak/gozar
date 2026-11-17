import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { scratch } from './route-schema-check.mjs';

test('public daemon refuses a legacy publishing bootstrap before provider effects', async t => {
  const home=await scratch(t);let effects=0,daemon;
  await writeFile(join(home,'bootstrap.json'),JSON.stringify({adapterId:'legacy-fixture',adapters:[{id:'legacy-fixture',audience:'public',ownership:'external-owned',capabilities:{},recipes:{}}],requirements:{clientReach:'internet'},targetPort:18765,consent:true}));
  const step=({command})=>{effects++;const phase=command.type==='stop'?'stopped':'blocked';return {state:{sessionId:'fixture',generation:1,resources:[],phase},snapshot:{sessionId:'fixture',generation:1,phase,resources:[],limitations:[],recommendations:[]},effects:[]};};
  await assert.rejects((async()=>{daemon=await serve(home,{step});await daemon.terminate();})(),error=>error.code==='unsupported');
  assert.equal(effects,0);
});
