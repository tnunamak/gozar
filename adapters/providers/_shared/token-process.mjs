// Deliver a token over anonymous pipes. No credential bytes enter argv, environment or a file.
import {spawn} from 'node:child_process';
import {processIdentity} from '../../../packages/gozar-node/process-identity.mjs';
const supervisor=String.raw`
const {spawn}=require('node:child_process');
const command='IFS= read -r token || exit 1; printf %s "$token" | bash -c \'printf "{\\"pid\\":%s}\\n" "$$" >&3; exec "$@" --token-file /dev/fd/0\' gozar-token-reader "$@"';
let input='',child,stopping=false,timer;
function stop(){if(stopping)return;stopping=true;if(!child)process.exit(0);if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);}}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{if(child)return;input+=chunk;if(input.length>65537)process.exit(1);const cut=input.indexOf('\n');if(cut<0)return;
 const token=input.slice(0,cut);input='';child=spawn('bash',['-c',command,'gozar-token-process',...process.argv.slice(1)],{detached:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},stdio:['pipe','ignore','ignore','pipe']});
 child.stdio[3].on('data',bytes=>process.stdout.write(bytes));child.once('error',()=>process.exit(1));child.once('exit',code=>{clearTimeout(timer);process.exit(stopping?0:code||1);});child.stdin.end(token+'\n');if(stopping)stop();
});process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function startTokenProcess({program,args,token}){
 if(typeof token!=='string'||!token||token.length>65536||/[\r\n]/.test(token))throw new Error('Invalid process credential syntax');
 const child=spawn(process.execPath,['-e',supervisor,program,...args],{env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},stdio:['pipe','pipe','ignore']});
 let exited=false;const done=new Promise(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
 child.stdin.on('error',()=>{});child.stdin.write(token+'\n');
 let providerPid,providerIdentity;
 try{
  providerPid=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(new Error('Process startup deadline')),5000);child.stdout.on('data',chunk=>{data+=chunk;if(data.length>1024){clearTimeout(timer);reject(new Error('Invalid process receipt'));return;}if(data.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(data.split('\n')[0]).pid);}catch{reject(new Error('Invalid process receipt'));}}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Process exited'));});});
  providerIdentity=await processIdentity(providerPid);if(!providerIdentity)throw new Error('Process ownership is unknown');
 }catch(error){child.stdin.end();throw error;}
 const alive=async()=>!exited||await processIdentity(providerPid)===providerIdentity;
 return {alive,async close(){
  child.stdin.end();let timer;await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);clearTimeout(timer);
  if(await processIdentity(providerPid)===providerIdentity){try{process.kill(providerPid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
  const deadline=Date.now()+1000;while(Date.now()<deadline&&await processIdentity(providerPid)===providerIdentity)await wait(20);
  if(await processIdentity(providerPid)===providerIdentity){try{process.kill(providerPid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  if(await alive())throw new Error('Process absence is unconfirmed');
 }};
}
