import net from 'node:net';

// Authenticated newline transport only; readiness, identity, and error policy
// remain decisions of the attached and daemon callers.
export function requestController({prepare,command,timeoutMs,timeoutError,oversizeError,endError,
  socketError=error=>error,prepareError=error=>error,replyValue=reply=>reply,
  connect=net.createConnection,schedule=setTimeout,unschedule=clearTimeout}) {
  return new Promise((resolve,reject)=>{
    let output='',settled=false,socket;
    const finish=(error,value)=>{
      if(settled)return;
      settled=true;unschedule(deadline);socket?.destroy();
      if(error)reject(error);else resolve(value);
    };
    const deadline=schedule(()=>finish(timeoutError()),timeoutMs);
    Promise.resolve().then(prepare).then(({path,identity})=>{
      if(settled)return;
      socket=connect(path);
      socket.once('connect',()=>{
        if(settled)return;
        const observation=command.type==='observe'
          ?{controllerIdentity:{pid:identity.pid,startIdentity:identity.startIdentity}}:{};
        socket.write(JSON.stringify({nonce:identity.nonce,command,...observation})+'\n');
      });
      socket.on('data',chunk=>{
        if(settled)return;
        output+=chunk;
        if(output.length>1_048_576)return finish(oversizeError());
        if(!output.includes('\n'))return;
        try{finish(null,replyValue(JSON.parse(output.split('\n')[0])));}
        catch(error){finish(error);}
      });
      socket.on('error',error=>finish(socketError(error)));
      socket.on('end',()=>finish(endError()));
    }).catch(error=>finish(prepareError(error)));
  });
}
