// A tiny always-on helper for the office PC. It does not touch the workplace site.
// It keeps one question open with the Ricotta server ("did someone press Turn on the worker?"),
// answered within a second of the press; if so, and the worker is not already running, it opens start-worker.cmd.
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

let handled=0, openedAt=0, openedRequest=0;
const call=async(route,method='GET',body,timeout=15000)=>{const r=await fetch(API+'/worker/'+route,{method,headers:{'x-worker-token':TOKEN,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error('server '+r.status);return r.json()};
console.log('Ricotta launcher is running.');
for(;;){
  let pause=1000;
  try{
    // Held open by the server until a start is requested (or ~25 s pass), then answered with the control status.
    const c=await call('wait?for=launcher','GET',undefined,35000);
    const asked=c.startRequestedAt?Date.parse(c.startRequestedAt):0;
    if(c.work)pause=5000;   // a start was answered; never ask again in a tight loop if it is still marked pending
    if(asked>handled&&asked>Date.parse(c.startHandledAt||0)){
      if(!c.workerOnline && asked!==openedRequest){
        console.log(new Date().toLocaleString()+' Start requested from the app: opening the worker.');
        // One verbatim command line, so cmd sees the window title in quotes exactly as written.
        spawn('cmd.exe',['/c','start "Ricotta worker" cmd /c start-worker.cmd scheduled'],{cwd:here,detached:true,stdio:'ignore',windowsVerbatimArguments:true}).unref();
        openedAt=Date.now();
        openedRequest=asked;
      }
      await call('control-handled','POST',{requestedAt:c.startRequestedAt});
      handled=asked;   // retry a failed acknowledgement without opening another worker window
    }
    // The worker window was opened but the worker never reported in, and did not say why itself.
    if(openedAt&&Date.now()-openedAt>180000){
      if(!c.workerOnline&&!(Date.parse(c.workerProblemAt||0)>openedAt))
        await call('problem','POST',{message:'The worker window opened on the PC but the worker did not start. Look at the "Ricotta worker" window on the PC for the reason.'});
      openedAt=0;
    }
  }catch(e){console.error(new Date().toLocaleString()+' '+e.message);pause=10000}
  await new Promise(r=>setTimeout(r,pause));
}
