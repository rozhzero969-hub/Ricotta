// Prints whether the worker is running: node status.mjs (exit code 0 = running, 1 = not running)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLock } from './lock.mjs';
const lock=path.join(path.dirname(fileURLToPath(import.meta.url)),'worker.lock');
const {state,held,age}=inspectLock(lock);
if(state==='missing'){console.log('NOT RUNNING: no worker lock file.');process.exit(1)}
if(state==='unknown'){console.log('UNKNOWN: worker lock cannot be verified; stop all workers before checking the lock file.');process.exit(1)}
const beat=age===null?'heartbeat unknown':`last heartbeat ${age}s ago`;
if(state==='alive'){console.log(`RUNNING: process ${held.pid}, ${beat}.${age===null||age>=90?' Heartbeat delayed; this process still owns the lock.':''}`);process.exit(0)}
console.log(`NOT RUNNING: process ${held.pid} not found, ${beat}.`);process.exit(1)
