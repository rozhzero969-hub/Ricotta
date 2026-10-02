// Run the real launcher loop for three fixture turns, without a PC or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../worker/launcher.mjs',import.meta.url),'utf8');
const loop=source.slice(source.indexOf('let handled=')).replace('for(;;){','for(let turn=0;turn<3;turn++){');
const requestedAt='2026-10-02T10:00:00.000Z';
let opens=0,acks=0,waits=0;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('spawn','fetch','AbortSignal','console','API','TOKEN','here','setTimeout',loop+'\nreturn {handled};');
const result=await run(()=>{opens++;return {unref(){}}},async(url,options)=>{
  if(url.endsWith('/wait?for=launcher')){waits++;return {ok:true,json:async()=>({work:true,workerOnline:false,startRequestedAt:requestedAt,startHandledAt:null})};}
  assert.ok(url.endsWith('/control-handled'));
  assert.equal(JSON.parse(options.body).requestedAt,requestedAt);
  acks++;return {ok:acks>1,status:503,json:async()=>({ok:true,handled:true})};
},AbortSignal,{log(){},error(){}},'https://fixture.invalid','fixture-token','fixture-dir',fn=>fn());
assert.equal(opens,1,'an acknowledgement retry does not open another worker window');
assert.equal(acks,2,'a failed acknowledgement is retried');
assert.equal(waits,3);assert.equal(result.handled,Date.parse(requestedAt));
console.log('Launcher control: PASS (request timestamp preserved, acknowledgement retry without duplicate starts)');
