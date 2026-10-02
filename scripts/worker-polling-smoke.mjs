// How the worker waits for work, simulated without sleeping or network calls.
// Run: node scripts/worker-polling-smoke.mjs
import assert from 'node:assert/strict';
import {HEARTBEAT_MS,WAIT_FAIL_DELAY_MS,WAIT_TIMEOUT_MS,waitForWork} from '../worker/polling.mjs';
const slept=[];const sleep=ms=>{slept.push(ms);return Promise.resolve()};
assert.equal(await waitForWork(async()=>({work:true}),sleep),true,'work announced by the server is picked up at once');
assert.equal(await waitForWork(async()=>({work:false}),sleep),false,'a quiet wait just asks again');
assert.deepEqual(slept,[],'no extra pause when the server answers');
assert.equal(await waitForWork(async()=>{throw new Error('offline')},sleep),false,'an unreachable server is not treated as work');
assert.deepEqual(slept,[WAIT_FAIL_DELAY_MS],'and is retried after a pause, never in a tight loop');
assert.equal(await waitForWork(async()=>({}),sleep),false,'an unexpected answer is not work');
assert.ok(WAIT_TIMEOUT_MS>25_000,'the PC waits longer than the server holds the question open');
assert.ok(HEARTBEAT_MS<120_000,'health reports stay within the app\'s online window');
// A quiet hour: one held-open question about every 25 s plus a health report every 90 s.
const callsPerHour=Math.ceil(3600/25)+Math.ceil(3600/(HEARTBEAT_MS/1000));
assert.ok(callsPerHour<200,'a quiet PC makes far fewer calls than the old one-minute checks (~300/hour)');
console.log('Worker polling smoke: PASS (instant pickup when the server announces work, retry pause when offline, heartbeat freshness, fewer calls)');
