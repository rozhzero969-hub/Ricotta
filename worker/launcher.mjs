// A tiny always-on helper for the office PC. It does not touch the workplace site.
// Every 15 seconds it asks the Ricotta server whether someone pressed "Turn on the worker" on
// their phone; if so, and the worker is not already running, it opens start-worker.cmd.
// Start it at sign-in with install-startup-task.ps1 (it is registered there together with the worker).
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import 'dotenv/config';
const here=path.dirname(fileURLToPath(import.meta.url));
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/stock-api';
const TOKEN=process.env.WORKER_TOKEN||'';
if(TOKEN.length<32){console.error('Put the worker token in worker\\.env first.');process.exit(1)}
let handled=0;
const call=async(route,method='GET')=>{const r=await fetch(API+'/worker/'+route,{method,headers:{'x-worker-token':TOKEN},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('server '+r.status);return r.json()};
console.log('Ricotta launcher is running. Leave this window open (it can be minimised).');
for(;;){
  try{
    const c=await call('control');
    const asked=c.startRequestedAt?Date.parse(c.startRequestedAt):0;
    if(asked>handled&&asked>Date.parse(c.startHandledAt||0)){
      handled=asked;
      if(!c.workerOnline){
        console.log(new Date().toLocaleString()+' Start requested from the app: opening the worker.');
        spawn('cmd.exe',['/c','start','"Ricotta worker"','cmd.exe','/c','start-worker.cmd scheduled'],{cwd:here,detached:true,stdio:'ignore'}).unref();
      }
      await call('control-handled','POST');
    }
  }catch(e){console.error(new Date().toLocaleString()+' '+e.message)}
  await new Promise(r=>setTimeout(r,15000));
}
