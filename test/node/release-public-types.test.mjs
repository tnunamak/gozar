import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkPublicTypes,parseArgs} from '../../scripts/check-public-types.mjs';

async function fixture(t,body){
 const root=await mkdtemp(join(tmpdir(),'public-types-unit-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=join(root,'node_modules','@tnunamak','gozar');await mkdir(pkg,{recursive:true});
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@tnunamak/gozar',type:'module',exports:{'.':{types:'./index.d.ts'},'./testing':{types:'./testing.d.ts'}}}));
 await writeFile(join(pkg,'index.d.ts'),'export {};');await writeFile(join(pkg,'testing.d.ts'),'export {};');
 const compiler=join(root,'compiler');await writeFile(compiler,'#!'+process.execPath+'\n'+body);await chmod(compiler,0o700);
 return {root,pkg,compiler};
}
test('explicit CLI arguments only, no environment or default compiler',()=>{
 assert.throws(()=>parseArgs([]),/installed-root/);
 assert.throws(()=>parseArgs(['--installed-root','relative','--tsc','/compiler']),/absolute/);
 assert.throws(()=>parseArgs(['--installed-root','/prefix','--tsc','/compiler','--unknown']),/Unknown/);
 assert.deepEqual(parseArgs(['--installed-root','/prefix','--tsc','/compiler']),{installedRoot:'/prefix',tsc:'/compiler'});
});
test('missing installation, compiler and testing export fail before compilation',async t=>{
 const f=await fixture(t,'process.exit(99)');
 await assert.rejects(checkPublicTypes({installedRoot:join(f.root,'absent'),tsc:f.compiler}),/installation/);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:join(f.root,'absent')}),/compiler/);
 await writeFile(join(f.pkg,'package.json'),JSON.stringify({exports:{'.':{types:'./index.d.ts'}}}));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/testing/);
});
test('actual child failure preserves diagnostics, strict config and owned cleanup',async t=>{
 // This process fixture is NOT a TypeScript compiler or type qualification.
 const f=await fixture(t,`const fs=require('node:fs');const p=require('node:path');
 const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 fs.writeFileSync(p.join(process.cwd(),'..','observed.json'),JSON.stringify({config,args:process.argv.slice(2),source:fs.readFileSync('consumer.ts','utf8')}));
 process.stdout.write('synthetic stdout');process.stderr.write('synthetic TS failure');process.exit(7);`);
 const sentinel=join(f.root,'keep');await writeFile(sentinel,'untouched');
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler});
 assert.equal(result.code,7);assert.equal(result.stdout,'synthetic stdout');assert.equal(result.stderr,'synthetic TS failure');assert.equal(result.timedOut,false);
 const observed=JSON.parse(await readFile(join(f.root,'observed.json'),'utf8'));
 assert.equal(observed.config.compilerOptions.strict,true);assert.equal(observed.config.compilerOptions.skipLibCheck,false);
 assert.deepEqual(observed.config.compilerOptions.types,[]);assert.equal(observed.config.compilerOptions.module,'NodeNext');
 assert.match(observed.source,/@tnunamak\/gozar\/testing/);
 assert.equal(await readFile(sentinel,'utf8'),'untouched');
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('compiler deadline kills and joins child then removes owned project',async t=>{
 const f=await fixture(t,'setInterval(()=>{},1000)');
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler,timeoutMs:100});
 assert.equal(result.timedOut,true);assert.notEqual(result.code,0);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('missing package and source-linked package cannot qualify',async t=>{
 const f=await fixture(t,'process.exit(99)');
 const source=join(f.root,'source');await rename(f.pkg,source);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/installed package/);
 await symlink(source,f.pkg,'dir');
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/materialized/);
});
test('spawn failure also cleans only its owned project',async t=>{
 const f=await fixture(t,'');
 await writeFile(f.compiler,'#!/nonexistent-gozar-unit-interpreter\n');
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/could not start/);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('escaped declaration export cannot qualify',async t=>{
 const f=await fixture(t,'process.exit(99)');
 await writeFile(join(f.root,'outside.d.ts'),'export {};');
 await writeFile(join(f.pkg,'package.json'),JSON.stringify({exports:{'.':{types:'./../../../outside.d.ts'},'./testing':{types:'./testing.d.ts'}}}));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/escaping/);
});
test('compiler output flood is capped, stops the child group and still cleans up',async t=>{
 const f=await fixture(t,`process.stdout.write('x'.repeat(5_000_000));setInterval(()=>{},1000)`);
 const started=Date.now();
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler,outputCapBytes:4096});
 assert.equal(result.overflow,true);assert.ok(Buffer.byteLength(result.stdout)<=4096);assert.ok(Date.now()-started<20000);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler,outputCapBytes:0}),/output cap/);
});
test('a link at any depth inside the installed package cannot qualify, dependency typings may be linked',async t=>{
 const f=await fixture(t,'process.exit(0)');
 const source=join(f.root,'source-internal.d.ts');await writeFile(source,'export declare const leak:never;');
 await mkdir(join(f.pkg,'dist','deep'),{recursive:true});
 await symlink(source,join(f.pkg,'dist','deep','internal.d.ts'));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/Source-linked installed package member: dist\/deep\/internal\.d\.ts/);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
 await rm(join(f.pkg,'dist'),{recursive:true});
 // An ordinary installed dependency may be linked (package-manager layout); it is not owned-package source.
 const dependency=join(f.root,'store','left-pad');await mkdir(dependency,{recursive:true});await writeFile(join(dependency,'index.d.ts'),'export {};');
 await symlink(dependency,join(f.root,'node_modules','left-pad'),'dir');
 const ok=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler});
 assert.equal(ok.code,0);assert.equal(ok.overflow,false);
});
