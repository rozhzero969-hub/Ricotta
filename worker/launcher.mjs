// A tiny always-on helper for the office PC. It does not touch the workplace site.
// Every 30 seconds it asks the Ricotta server whether someone pressed "Turn on the worker" in
// the app; if so, and the worker is not already running, it opens start-worker.cmd.
// install-startup-task.ps1 starts it at sign-in with no window (so it cannot be closed by
// accident) and starts it again within 5 minutes if it ever stops.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import 'dotenv/config';
import {acquireLock} from './lock.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/stock-api';
const TOKEN=process.env.WORKER_TOKEN||'';
if(TOKEN.length<32){console.error('Put the worker token in worker\\.env first.');process.exit(1)}
// Only one launcher at a time; a delayed heartbeat never overrides a live process.
const LOCK=path.join(here,'launcher.lock');
const launcherLock=acquireLock(LOCK);
if(!launcherLock.acquired){console.log(`${launcherLock.reason}${launcherLock.held?.pid?` (process ${launcherLock.held.pid})`:''}`);process.exit(0)}
setInterval(()=>{try{launcherLock.heartbeat()}catch(error){console.error(error.message);process.exit(1)}},20000).unref();
process.on('exit',()=>{try{launcherLock.release()}catch{}});
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
  await new Promise(r=>setTimeout(r,30000));
}
