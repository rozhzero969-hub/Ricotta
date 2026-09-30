// Prints whether the worker is running: node status.mjs (exit code 0 = running, 1 = not running)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const lock=path.join(path.dirname(fileURLToPath(import.meta.url)),'worker.lock');
let held;try{held=JSON.parse(readFileSync(lock,'utf8'))}catch{console.log('NOT RUNNING: no worker lock file.');process.exit(1)}
const age=Math.round((Date.now()-Number(held.at))/1000);
let alive=false;try{process.kill(held.pid,0);alive=true}catch(e){alive=e.code==='EPERM'}
if(alive&&age<90){console.log(`RUNNING: process ${held.pid}, last heartbeat ${age}s ago.`);process.exit(0)}
console.log(`NOT RUNNING: lock is stale (process ${held.pid}${alive?'':' not found'}, last heartbeat ${age}s ago).`);process.exit(1)
