// A tiny always-on helper for the office PC. It does not touch the workplace site.
// Every 15 seconds it asks the Ricotta server whether someone pressed "Turn on the worker" in
// the app; if so, and the worker is not already running, it opens start-worker.cmd.
// install-startup-task.ps1 starts it at sign-in with no window (so it cannot be closed by
// accident) and starts it again within 5 minutes if it ever stops.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import 'dotenv/config';
const here=path.dirname(fileURLToPath(import.meta.url));
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/stock-api';
const TOKEN=process.env.WORKER_TOKEN||'';
if(TOKEN.length<32){console.error('Put the worker token in worker\\.env first.');process.exit(1)}
// Only one launcher at a time (the lock carries a heartbeat, so a stale one from a reboot is ignored).
const LOCK=path.join(here,'launcher.lock');
const lockBody=()=>JSON.stringify({pid:process.pid,at:Date.now()});
try{
  const held=JSON.parse(readFileSync(LOCK,'utf8')||'{}');
  let alive=false;
  if(held.pid>0&&held.pid!==process.pid&&Date.now()-Number(held.at)<60000){try{process.kill(held.pid,0);alive=true}catch(e){alive=e.code==='EPERM'}}
  if(alive){console.log(`Another launcher is already running (process ${held.pid}).`);process.exit(0)}
}catch{}
writeFileSync(LOCK,lockBody());
setInterval(()=>{try{writeFileSync(LOCK,lockBody())}catch{}},20000).unref();
process.on('exit',()=>{try{rmSync(LOCK,{force:true})}catch{}});
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>process.exit(0));

let handled=0;
const call=async(route,method='GET')=>{const r=await fetch(API+'/worker/'+route,{method,headers:{'x-worker-token':TOKEN},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('server '+r.status);return r.json()};
console.log('Ricotta launcher is running.');
for(;;){
  try{
    const c=await call('control');
    const asked=c.startRequestedAt?Date.parse(c.startRequestedAt):0;
    if(asked>handled&&asked>Date.parse(c.startHandledAt||0)){
      handled=asked;
      if(!c.workerOnline){
        console.log(new Date().toLocaleString()+' Start requested from the app: opening the worker.');
        // One verbatim command line, so cmd sees the window title in quotes exactly as written.
        spawn('cmd.exe',['/c','start "Ricotta worker" cmd /c start-worker.cmd scheduled'],{cwd:here,detached:true,stdio:'ignore',windowsVerbatimArguments:true}).unref();
      }
      await call('control-handled','POST');
    }
  }catch(e){console.error(new Date().toLocaleString()+' '+e.message)}
  await new Promise(r=>setTimeout(r,15000));
}
