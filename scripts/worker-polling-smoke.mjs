// Simulate time without sleeping or making any network calls.
import assert from 'node:assert/strict';
import {MAX_IDLE_POLL_MS,nextPollDelay} from '../worker/polling.mjs';
let delay=5000;
assert.deepEqual(Array.from({length:5},()=>delay=nextPollDelay(delay,false,5000)),[10000,20000,40000,60000,60000]);
assert.equal(nextPollDelay(delay,true,5000),5000,'an open approval returns immediately to the configured poll');
let elapsed=0,cycles=0;delay=5000;
while(elapsed<3600000){cycles++;delay=nextPollDelay(delay,false,5000);elapsed+=delay;}
assert.ok(cycles<70,'empty queues use substantially fewer calls than 720 cycles/hour');
assert.ok(MAX_IDLE_POLL_MS<120000,'idle heartbeats stay within the API online freshness window');
console.log('Worker polling smoke: PASS (idle backoff, responsive approvals, bounded pickup delay and heartbeat freshness)');
