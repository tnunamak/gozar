import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isPublicIp,resolvePublicOrigin,createPinnedPublicRequest,PublicRelayVerifier } from '../../packages/gozar-node/public-relay.mjs';

function network(t,handler) {
  const calls=[];
  t.mock.method(https,'request',(options,onResponse)=>{
    const request=new EventEmitter();let response;
    request.end=body=>{
      calls.push({options,body});
      queueMicrotask(()=>{
        const answer=handler(options,body);
        const stream=answer.chunks ?? [Buffer.from(JSON.stringify(answer.json ?? {}))];
        response=Readable.from(stream,{objectMode:false});
        response.statusCode=answer.status ?? 200;
        response.headers=answer.headers ?? {'content-type':'application/json'};
        let peer=options.hostname;
        options.lookup(options.hostname,{all:true},(_error,addresses)=>{peer=addresses[0].address;});
        response.socket={remoteAddress:answer.peer ?? peer,authorized:answer.authorized ?? true,getProtocol:()=> 'TLSv1.3'};
        onResponse(response);
      });
    };
    request.destroy=error=>{ if(error)queueMicrotask(()=>request.emit('error',error));response?.destroy();return request; };
    return request;
  });
  return calls;
}
function dns(options,address='8.8.8.8') {
  if(options.hostname!=='1.1.1.1')return null;
  const type=Number(new URL(options.path,'https://1.1.1.1').searchParams.get('type'));
  return {json:{Status:0,Answer:type===1?[{type:1,data:address}]:[]}};
}

test('public IP classifier rejects private, loopback, CGNAT, mapped, metadata and documentation addresses',()=>{
  for(const ip of ['8.8.8.8','1.1.1.1','100.128.0.1','199.38.181.54','2606:4700:4700::1111'])assert.equal(isPublicIp(ip),true,ip);
  for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','100.127.255.255','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','fc00::1','fe80::1','::ffff:8.8.8.8','2001:db8::1','3ffe::1','3fff::1','not-an-ip'])assert.equal(isPublicIp(ip),false,ip);
});

test('public DNS is pinned to resolver IP and all target HTTPS requests retain the same IP, SNI and certificate checks',async t=>{
  const calls=network(t,options=>dns(options) ?? {json:{ok:true},headers:{server:'relay-fixture','set-cookie':'secret=never-report'}});
  const resolution=await resolvePublicOrigin('https://service.example:8443');
  assert.equal(resolution.resolvedIp,'8.8.8.8');assert.equal(resolution.resolver,'https://1.1.1.1/dns-query');
  const request=createPinnedPublicRequest(resolution);
  const first=await request('https://service.example:8443/one');assert.deepEqual(await first.json(),{ok:true});
  await (await request('/two')).json();
  for(const {options} of calls){assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);}
  for(const {options} of calls.slice(2)){assert.equal(options.hostname,'service.example');assert.equal(options.servername,'service.example');assert.equal(options.port,'8443');}
  assert.equal(request.evidence.length,2);assert.equal(request.evidence[0].resolvedIp,'8.8.8.8');
  assert.equal(request.evidence[0].relayHeaders['set-cookie'],undefined);
  assert.throws(()=>request('https://other.example/'),/outside/);
  assert.throws(()=>request('/x',{headers:{host:'other.example'}}),/Host header/);
});

test('private DNS answers, peer mismatch, TLS failure and redirects fail closed',async t=>{
  network(t,options=>dns(options,'100.64.0.1'));
  await assert.rejects(resolvePublicOrigin('https://service.example'),/nonpublic/);
  t.mock.restoreAll();
  for(const answer of [{peer:'127.0.0.1'},{authorized:false},{status:302,headers:{location:'http://127.0.0.1/'}}]){
    network(t,()=>answer);
    const request=createPinnedPublicRequest({origin:'https://service.example',resolvedIp:'8.8.8.8'});
    await assert.rejects(request('/'),/mismatch|redirects/);
    t.mock.restoreAll();
  }
});

test('default verifier binds public-relay receipt to issued permission, gate nonce and timed SSE without product tool assumptions',async t=>{
  const nonce='fixture-instance';
  const calls=network(t,options=>{
    const answer=dns(options);if(answer)return answer;
    if(options.path==='/owned/identity')return {json:{nonce}};
    assert.equal(options.path,'/owned/stream');
    async function* chunks(){for(let sequence=0;sequence<3;sequence++){if(sequence)await new Promise(resolve=>setTimeout(resolve,120));yield Buffer.from(`data: ${JSON.stringify({nonce,sequence})}\n\n`);}}
    return {headers:{'content-type':'text/event-stream',server:'public-relay-fixture'},chunks:chunks()};
  });
  const verifier=new PublicRelayVerifier();
  const context={origin:'https://service.example',vantage:'public',authorization:{nonceRef:'one',verifierRef:'verify',expiresAtMs:Date.now()+10000,allowPublicRelay:true},
    challenge:{identityPath:'/owned/identity',streamPath:'/owned/stream',nonce},requirements:{sse:true},signal:AbortSignal.timeout(3000)};
  const result=await verifier.verify(context);
  assert.equal(result.probeReceipt.networkPath,'public-relay');assert.equal(result.probeReceipt.remote,false);assert.equal(result.probeReceipt.publicDns,true);
  assert.equal(result.probeReceipt.resolvedIp,'8.8.8.8');assert.equal(result.probeReceipt.tlsServername,'service.example');assert.equal(result.probeReceipt.sse,true);
  assert.equal(result.probeReceipt.streamableHttp,false);
  assert.equal(calls.filter(call=>call.options.hostname==='service.example').length,2);
  await assert.rejects(verifier.verify({...context,authorization:{...context.authorization,allowPublicRelay:false}}),/authority/);
});

test('driver cannot enable public-relay authority by changing the completion or current host after issue',async t=>{
  const {fixture}=await import('./helpers.mjs');
  const {prepareHost}=await import('../../packages/gozar-node/host.mjs');
  const {createGate}=await import('../../packages/gozar-node/gate.mjs');
  const {driver}=await fixture(t,{});
  const gate=await createGate(1);t.after(()=>gate.close());driver.targetPort=gate.port;driver.origin='https://service.example';
  const verifier=new PublicRelayVerifier();
  await prepareHost(driver,{bindings:{}},{gate,probeExecutor:verifier});
  const original={...driver.host.probe,allowPublicRelay:false};
  verifier.verify=async()=>{
    driver.host.probe.allowPublicRelay=true;
    const now=driver.nowMs();
    return {probeReceipt:{nonceRef:original.nonceRef,verifierRef:original.verifierRef,origin:driver.origin,vantage:'public',
      observedAtMs:now,expiresAtMs:now+1000,networkPath:'public-relay',remote:false,publicDns:true,resolvedIp:'8.8.8.8',tlsServername:'service.example',tls:true,instanceMatched:true,sse:true}};
  };
  const result=await driver.execute({id:'issued-denied',sessionId:'test',generation:1,kind:'http-probe',operation:'probe',url:driver.origin,
    vantage:'public',recipeRef:'probe',stepId:'probe',stage:'probe',probe:original,sse:true});
  assert.equal(result.ok,false);assert.equal(driver.acceptedProbeReceipt,undefined);
});
