// Used only after an explicit testing factory has installed a scoped dispatcher.
export function testingFetch(dispatchEffect){
 return async(url,options={})=>{
  const reply=await dispatchEffect({kind:'network',operation:'fetch',input:{url:String(url),method:options.method??'GET',headers:Object.fromEntries(new Headers(options.headers))}});
  if(!Number.isInteger(reply?.status)||!Array.isArray(reply.chunks)||reply.chunks.length>4096)throw new Error('Invalid fixture HTTP response');
  let length=0;for(const chunk of reply.chunks){if(typeof chunk.data!=='string'||!Number.isFinite(chunk.delayMs)||chunk.delayMs<0||chunk.delayMs>15000)throw new Error('Invalid fixture response chunk');length+=Buffer.byteLength(chunk.data,'base64');}if(length>4*1024*1024)throw new Error('Fixture response is too large');
  let timer,cancelled=false;
  const stream=new ReadableStream({async start(controller){try{for(const chunk of reply.chunks){if(cancelled||options.signal?.aborted)throw new Error('Fixture request cancelled');if(chunk.delayMs)await new Promise(resolve=>timer=setTimeout(resolve,chunk.delayMs));if(cancelled||options.signal?.aborted)throw new Error('Fixture request cancelled');controller.enqueue(Buffer.from(chunk.data,'base64'));}controller.close();}catch(error){if(!cancelled)controller.error(error);}},cancel(){cancelled=true;clearTimeout(timer);}});
  return new Response(stream,{status:reply.status,headers:reply.headers});
 };
}
