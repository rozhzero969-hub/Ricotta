// Filesystem-only single-process lock shared by the worker, launcher and status tool.
// Heartbeats describe health; only a confirmed dead PID permits automatic recovery.
import {randomUUID} from 'node:crypto';
import {linkSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';

function processAlive(pid){
  try{process.kill(pid,0);return true}catch(error){
    // Permission errors (and other uncertain failures) must never authorize takeover.
    return error.code!=='ESRCH';
  }
}

export function inspectLock(file){
  let held;
  try{held=JSON.parse(readFileSync(file,'utf8'))}catch(error){
    return {state:error.code==='ENOENT'?'missing':'unknown',held:null,age:null};
  }
  if(!held||!Number.isSafeInteger(held.pid)||held.pid<=0)return {state:'unknown',held,age:null};
  const age=Number.isFinite(held.at)?Math.max(0,Math.round((Date.now()-held.at)/1000)):null;
  return {state:processAlive(held.pid)?'alive':'dead',held,age};
}

function publish(file,body,replace=false){
  // Publish complete JSON atomically, so another process never mistakes a partly
  // written heartbeat for a dead owner. Hard links support exclusive publication.
  const temporary=`${file}.${randomUUID()}.tmp`;
  try{
    writeFileSync(temporary,JSON.stringify(body),{flag:'wx',mode:0o600});
    if(replace)renameSync(temporary,file);else linkSync(temporary,file);
  }finally{
    try{unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error}
  }
}

export function acquireLock(file){
  const token=randomUUID();
  const body=()=>({pid:process.pid,token,at:Date.now()});
  const denied=(inspection,reason)=>({acquired:false,...inspection,reason});
  const heldResult=()=>({
    acquired:true,
    heartbeat(){
      if(inspectLock(file).held?.token!==token)throw new Error('Lock ownership changed; stopping to prevent concurrent workers.');
      publish(file,body(),true);
    },
    release(){
      // A live owner cannot be reclaimed. Check its unique token as well, so an
      // old exit handler cannot remove a lock published by a replacement worker.
      if(inspectLock(file).held?.token!==token)return false;
      try{unlinkSync(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}
    }
  });
  try{publish(file,body());return heldResult()}catch(error){if(error.code!=='EEXIST')throw error}
  let inspection=inspectLock(file);
  if(inspection.state==='alive')return denied(inspection,'Another process is already running.');
  if(inspection.state==='unknown')return denied(inspection,'The lock cannot be verified; stop all workers before checking the lock file.');

  // Serialize dead-lock recovery. Without this guard, two starters can both read
  // the old PID and the second can delete the first starter's newly acquired lock.
  // The critical section is synchronous and the guard is never reclaimed by age.
  // A crash during recovery fails closed and gives a concrete recovery diagnostic.
  const recovery=`${file}.recovery`;
  try{mkdirSync(recovery)}catch(error){
    if(error.code!=='EEXIST')throw error;
    return denied(inspectLock(file),`Lock recovery is busy or was interrupted. If it persists, stop all workers and remove ${recovery}.`);
  }
  try{
    inspection=inspectLock(file);
    if(inspection.state==='alive')return denied(inspection,'Another process is already running.');
    if(inspection.state==='unknown')return denied(inspection,'The lock cannot be verified; stop all workers before checking the lock file.');
    if(inspection.state==='dead')unlinkSync(file);
    try{publish(file,body());return heldResult()}catch(error){
      if(error.code!=='EEXIST')throw error;
      return denied(inspectLock(file),'Another process acquired the lock.');
    }
  }finally{rmdirSync(recovery)}
}
