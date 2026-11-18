import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

// Dedicated Linux/macOS stdlib PTY oracle. Missing tooling is an explicit failure.
const childSource = String.raw`
import {promptInputRequirement} from MODULE_URL;
if (!process.stdin.isTTY) throw Error('real TTY required');
const prior = process.env.PRIOR === 'true';
if (prior) process.stdin.setRawMode(true);
const before = Boolean(process.stdin.isRaw);
let received = 0;
const observe = bytes => process.stdout.write(JSON.stringify({received:received += bytes.length})+'\n');
process.stdin.on('data', observe); process.stdin.pause();
let outcome;
try {
  const value = await promptInputRequirement({label:'Synthetic local input',secret:true,required:true});
  outcome = {kind:'submit',equal:value===process.env.CANARY,length:value.length};
} catch(error) {
  outcome = {kind:'reject',code:error.code};
}
const paused = process.stdin.isPaused();
process.stdin.off('data', observe);
process.stdout.write(JSON.stringify({result:true,before,after:Boolean(process.stdin.isRaw),paused,...outcome})+'\n');
setInterval(()=>{},1000);
`;

const driver = String.raw`
import os, sys, json, time, select, subprocess, signal, errno, base64
try:
    import pty, termios
except ImportError:
    raise SystemExit("UNSUPPORTED: POSIX Python pty/termios required")
cfg=json.loads(sys.argv[1])
canary=cfg["canary"].encode("ascii")
reports=[]
for mode in ("submit","cancel","eof"):
  for prior in (False,True):
    for style in ("typed","paste"):
      master=slave=child=None
      primary=None
      cleanup=[]
      capture={"terminal":bytearray(),"stdout":bytearray(),"stderr":bytearray()}
      active={}
      pending=b""
      received=0
      result=None
      deadline=time.monotonic()+8
      def read_ready(timeout):
        global pending,received,result
        ready,_,_=select.select(list(active),[],[],timeout)
        for fd in ready:
          name=active[fd]
          try: data=os.read(fd,4096)
          except OSError as error:
            if name=="terminal" and error.errno==errno.EIO: data=b""
            else: raise
          if not data:
            del active[fd]
            continue
          capture[name].extend(data)
          if sum(map(len,capture.values()))>65536: raise RuntimeError("capture limit")
          if name=="stdout":
            pending+=data
            while b"\n" in pending:
              line,pending=pending.split(b"\n",1)
              row=json.loads(line)
              if "received" in row: received=row["received"]
              if row.get("result"):
                if result is not None: raise RuntimeError("duplicate result")
                result=row
      def pump(predicate):
        while not predicate():
          if time.monotonic()>=deadline: raise RuntimeError("handshake timeout")
          if not active: raise RuntimeError("streams closed before handshake")
          read_ready(.02)
          # Drain pipes even after exit; a final result may still be buffered.
          if child.poll() is not None and not active and result is None:
            raise RuntimeError("child exited without result")
      def send(data):
        view=memoryview(data)
        while view:
          n=os.write(master,view)
          if n<=0: raise RuntimeError("PTY write failed")
          view=view[n:]
      try:
        master,slave=pty.openpty()
        initial=termios.tcgetattr(slave)
        env={k:os.environ[k] for k in ("PATH","LANG","LC_ALL") if k in os.environ}
        env.update(CANARY=cfg["canary"],PRIOR=str(prior).lower())
        child=subprocess.Popen([cfg["node"],"--input-type=module","--eval",cfg["source"]],
          stdin=slave,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,env=env)
        active={master:"terminal",child.stdout.fileno():"stdout",child.stderr.fileno():"stderr"}
        pump(lambda:b"Secret (hidden): " in capture["stderr"])
        if termios.tcgetattr(slave)[3]&termios.ECHO:
          raise RuntimeError("visible prompt before echo disabled")
        if style=="paste":
          send(canary); pump(lambda:received>=len(canary))
        else:
          for index,byte in enumerate(canary):
            send(bytes([byte])); pump(lambda:received>=index+1)
        read_ready(0)
        if capture["terminal"]: raise RuntimeError("terminal echoed input")
        if mode=="eof":
          # Genuine hangup. A disconnected terminal has no restorable kernel mode.
          active.pop(master,None); os.close(master); master=None
        else: send(b"\r" if mode=="submit" else b"\x03")
        pump(lambda:result is not None)
        if result["before"]!=prior or not result["paused"]: raise RuntimeError("lifecycle mismatch")
        if mode=="submit":
          if result.get("kind")!="submit" or result.get("equal")!=True or result.get("length")!=len(canary):
            raise RuntimeError("submit mismatch")
        elif result.get("kind")!="reject" or result.get("code")!="invalid_input":
          raise RuntimeError("cancel/EOF must reject with invalid_input")
        if mode!="eof":
          if result["after"]!=prior: raise RuntimeError("raw flag restoration mismatch")
          flags=termios.tcgetattr(slave)[3]
          mask=termios.ECHO|termios.ICANON|termios.ISIG
          expected=0 if prior else initial[3]&mask
          if flags&mask!=expected: raise RuntimeError("kernel mode restoration mismatch")
        reports.append({"mode":mode,"prior":prior,"style":style,
          "restoration":"disconnected-terminal-unavailable" if mode=="eof" else "verified"})
      except BaseException as error:
        # Never include captured bytes, child source, canary, or arbitrary exception messages.
        primary=type(error).__name__
      finally:
        if child is not None:
          try:
            if child.poll() is None: child.terminate()
            try: child.wait(timeout=1)
            except subprocess.TimeoutExpired:
              child.kill(); child.wait(timeout=1)
          except BaseException as error: cleanup.append("child:"+type(error).__name__)
          # Consume all remaining stdout/stderr/terminal bytes after owned child exits.
          until=time.monotonic()+1
          try:
            while active and time.monotonic()<until: read_ready(.02)
            for fd,name in list(active.items()):
              if name!="terminal": cleanup.append("undrained:"+name)
          except BaseException as error: cleanup.append("drain:"+type(error).__name__)
          for stream in (child.stdout,child.stderr):
            try: stream.close()
            except BaseException as error: cleanup.append("pipe:"+type(error).__name__)
        for fd in (master,slave):
          if fd is not None:
            try: os.close(fd)
            except BaseException as error: cleanup.append("pty:"+type(error).__name__)
        for data in capture.values():
          if canary in data: cleanup.append("plaintext leak")
          if base64.b64encode(canary) in data: cleanup.append("base64 leak")
      if primary or cleanup:
        print(json.dumps({"case":[mode,prior,style],"primary":primary,"cleanup":cleanup}))
        raise SystemExit(1)
print(json.dumps({"cases":reports}))
`;

test('genuine hidden prompt: typed/pasted PTY input, cancellation, hangup and live mode restoration',{timeout:120000},async()=>{
  assert.ok(['linux','darwin'].includes(process.platform),'UNSUPPORTED: Linux/macOS POSIX PTY required');
  const canary='SYNTHETIC_LOCAL_TERMINAL_CANARY_1117';
  const moduleUrl=new URL(['..','..','packages','gozar-node','input-requirements.mjs'].join('/'),import.meta.url).href;
  const config={node:process.execPath,canary,source:childSource.replace('MODULE_URL',JSON.stringify(moduleUrl))};
  const result=await new Promise(resolve=>{
    const child=spawn('python3',['-c',driver,JSON.stringify(config)],{
      detached:true,stdio:['ignore','pipe','pipe'],
      env:Object.fromEntries(['PATH','LANG','LC_ALL'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))
    });
    let stdout='',stderr='',failure=null,killTimer;
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')failure??='owned group cleanup failed';}};
    const stop=reason=>{failure??=reason;kill('SIGTERM');killTimer??=setTimeout(()=>kill('SIGKILL'),1000);};
    const timer=setTimeout(()=>stop('PTY watchdog expired'),100000);
    const capture=(name,data)=>{
      const remaining=65536-Buffer.byteLength(stdout)-Buffer.byteLength(stderr);
      const kept=data.subarray(0,Math.max(0,remaining)).toString();
      if(name==='stdout')stdout+=kept;else stderr+=kept;
      if(data.length>remaining)stop('capture limit exceeded');
    };
    child.stdout.on('data',data=>capture('stdout',data));
    child.stderr.on('data',data=>capture('stderr',data));
    child.on('error',()=>{failure??='UNSUPPORTED: python3 could not start';});
    child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);resolve({code,signal,stdout,stderr,failure});});
  });
  assert.equal((result.stdout+result.stderr).includes(canary),false,'plaintext escaped driver');
  assert.equal((result.stdout+result.stderr).includes(Buffer.from(canary).toString('base64')),false,'base64 escaped driver');
  assert.equal(result.failure,null,result.failure??'');
  assert.equal(result.code,0,'PTY oracle failed: '+result.stdout+' '+result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.cases.length,12);
  for(const item of report.cases)assert.equal(item.restoration,item.mode==='eof'?'disconnected-terminal-unavailable':'verified');
});
