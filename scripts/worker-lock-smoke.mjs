// Offline lock contention and ownership checks; no browser, network or worker token.
// Run: node scripts/worker-lock-smoke.mjs
import assert from 'node:assert/strict';
import {fork, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireLock, inspectLock} from '../worker/lock.mjs';

const script=fileURLToPath(import.meta.url);
if(process.argv[2]==='--contender'){
  let held;
  process.on('message',message=>{
    if(message==='acquire'){
      held=acquireLock(process.argv[3]);
      process.send({acquired:held.acquired,pid:process.pid});
    }
    if(message==='release'){
      if(held?.acquired)held.release();
      process.exit(0);
    }
  });
  process.on('exit',()=>{if(held?.acquired)held.release()});
}else{
  const dir=mkdtempSync(path.join(tmpdir(),'ricotta-worker-lock-'));
  const file=path.join(dir,'worker.lock');
  const children=new Set();
  const fixture=body=>writeFileSync(file,JSON.stringify(body));
  const decoded=()=>JSON.parse(readFileSync(file,'utf8'));
  const deadPid=spawnSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8'}).stdout.trim()*1;
  const exited=child=>new Promise(resolve=>child.once('exit',resolve));

  async function contend(stale=false){
    if(stale)fixture({pid:deadPid,at:Date.now()-3600000});
    const group=Array.from({length:12},()=>{
      const child=fork(script,['--contender',file],{stdio:['ignore','inherit','inherit','ipc']});
      children.add(child);
      child.once('exit',()=>children.delete(child));
      return child;
    });
    const responses=await Promise.all(group.map(child=>new Promise((resolve,reject)=>{
      child.once('message',resolve);
      child.once('error',reject);
      child.once('exit',code=>reject(new Error(`Contender exited early (${code})`)));
      child.send('acquire');
    })));
    assert.equal(responses.filter(result=>result.acquired).length,1,'exactly one process wins concurrent startup');
    assert.equal(decoded().pid,responses.find(result=>result.acquired).pid,'the winner keeps its own lock');
    const stops=group.map(exited);
    group.forEach(child=>child.send('release'));
    await Promise.all(stops);
    assert.equal(existsSync(file),false,'only the owner removes its lock on exit');
    assert.equal(existsSync(`${file}.recovery`),false,'normal recovery leaves no guard');
  }

  try{
    assert.equal(inspectLock(file).state,'missing');
    await contend();
    for(let round=0;round<3;round++)await contend(true);

    // An old heartbeat must not authorize takeover of any live PID, including our own.
    fixture({pid:process.pid,at:Date.now()-3600000});
    const liveBody=readFileSync(file,'utf8');
    assert.equal(inspectLock(file).state,'alive');
    assert.equal(acquireLock(file).acquired,false);
    assert.equal(readFileSync(file,'utf8'),liveBody);
    rmSync(file);

    // A lock from before the computer last started is dead, even if its process number is in use again.
    fixture({pid:process.pid,at:Date.now()-3600000,boot:Date.now()-30*86400000});
    assert.equal(inspectLock(file).state,'dead');
    const afterReboot=acquireLock(file);
    assert.equal(afterReboot.acquired,true,'a lock left over from before a restart is replaced');
    assert.equal(afterReboot.release(),true);

    const held=acquireLock(file);
    assert.equal(held.acquired,true);
    const token=decoded().token;
    held.heartbeat();
    assert.equal(decoded().token,token);
    assert.equal(inspectLock(file).state,'alive');
    assert.equal(acquireLock(file).acquired,false,'same PID cannot acquire twice');
    assert.equal(held.release(),true);
    assert.equal(held.release(),false,'release is idempotent');

    const oldOwner=acquireLock(file);
    fixture({pid:process.pid,token:'replacement-owner',at:Date.now()});
    assert.throws(()=>oldOwner.heartbeat(),/ownership changed/);
    assert.equal(oldOwner.release(),false,'an old exit handler cannot delete another owner');
    assert.equal(decoded().token,'replacement-owner');
    rmSync(file);

    for(const invalid of ['broken JSON',JSON.stringify({pid:0}),JSON.stringify({pid:-1}),JSON.stringify({pid:'12'})]){
      writeFileSync(file,invalid);
      assert.equal(inspectLock(file).state,'unknown');
      assert.equal(acquireLock(file).acquired,false,'uncertain owners fail closed');
      assert.equal(readFileSync(file,'utf8'),invalid);
      rmSync(file);
    }

    fixture({pid:deadPid,at:Date.now()-3600000});
    mkdirSync(`${file}.recovery`);
    assert.match(acquireLock(file).reason,/recovery is busy or was interrupted/);
    assert.equal(decoded().pid,deadPid,'interrupted recovery cannot replace an owner unsafely');
    rmSync(`${file}.recovery`,{recursive:true});
    assert.equal(acquireLock(file).release(),true,'recovery works after the interrupted guard is cleared');

    // Exercise the real status CLI in a disposable directory instead of touching the office lock.
    const source=path.resolve(path.dirname(script),'../worker');
    copyFileSync(path.join(source,'status.mjs'),path.join(dir,'status.mjs'));
    copyFileSync(path.join(source,'lock.mjs'),path.join(dir,'lock.mjs'));
    fixture({pid:process.pid,at:Date.now()-3600000});
    const status=spawnSync(process.execPath,[path.join(dir,'status.mjs')],{encoding:'utf8'});
    assert.equal(status.status,0,'live process with a stale heartbeat remains running');
    assert.match(status.stdout,/RUNNING:.*Heartbeat delayed/);
    fixture({pid:deadPid,at:Date.now()});
    assert.equal(spawnSync(process.execPath,[path.join(dir,'status.mjs')]).status,1,'dead process is not running');
    console.log(JSON.stringify({result:'PASS',checks:'exclusive startup; serialized crash recovery; delayed live heartbeat preserved; locks from before a restart replaced; ownership-safe heartbeat and cleanup; invalid owners fail closed; status agrees with process liveness'}));
  }finally{
    for(const child of children)child.kill();
    rmSync(dir,{recursive:true,force:true});
  }
}
