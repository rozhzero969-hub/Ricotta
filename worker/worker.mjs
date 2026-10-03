// Deliberately conservative browser worker: semantic controls, visible checks,
// no coordinate clicks, no automatic retry after a click, and dry-run by default.
import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTransfer, TRANSFER_PAGE } from './transfer.mjs';
import { prepareReceipt, submitReceipt, RECEIPT_PAGE } from './receipt.mjs';
import { prepareItem, submitItem, formOpen, STOCK_PAGE } from './items.mjs';
import {HEARTBEAT_MS,WAIT_TIMEOUT_MS,waitForWork} from './polling.mjs';
import { acquireLock } from './lock.mjs';
import { onLoginPage, signIn } from './signin.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const PAGE=TRANSFER_PAGE;
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/stock-api';
const TOKEN=process.env.WORKER_TOKEN||'';
const LIVE=process.env.ALLOW_SUBMIT==='1';
const SUCCESS=(process.env.CONFIRMED_SUCCESS_TEXT||'').trim();
// Receipts are saved only with ALLOW_SUBMIT=1 and the exact success message the workplace shows after
// "Receive & send to finance", learned during a supervised first run.
const RECEIPT_SUCCESS=(process.env.RECEIPT_SUCCESS_TEXT||'').trim();
const RECEIPTS_LIVE=LIVE&&!!RECEIPT_SUCCESS;
// Ingredients are saved only with ALLOW_SUBMIT=1 and both exact success messages (after "Add ingredient" and after "Save").
const ITEM_SUCCESS={create:(process.env.ITEM_ADD_SUCCESS_TEXT||'').trim(),edit:(process.env.ITEM_EDIT_SUCCESS_TEXT||'').trim()};
const ITEMS_LIVE=LIVE&&!!ITEM_SUCCESS.create&&!!ITEM_SUCCESS.edit;
const POLL=Math.min(60,Math.max(5,Number(process.env.POLL_SECONDS)||5))*1000;
// The workplace PIN, only for signing in by itself when the site shows its sign-in page. Never logged or sent.
const WORKPLACE_PIN=(process.env.WORKPLACE_PIN||'').trim();
if(TOKEN.length<32)throw new Error('Set WORKER_TOKEN in worker/.env');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Only one worker may drive the workplace page. A lock is recovered only after
// its process has exited; an old heartbeat alone never permits another driver.
const LOCK=path.join(here,'worker.lock');
const workerLock=acquireLock(LOCK);
if(!workerLock.acquired){console.error(`${workerLock.reason}${workerLock.held?.pid?` (process ${workerLock.held.pid})`:''}`);process.exit(0)}
process.on('exit',()=>{try{workerLock.release()}catch{}});
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>process.exit(0));
setInterval(()=>{try{workerLock.heartbeat()}catch(error){console.error(error.message);process.exit(1)}},30000).unref();
async function api(route,method='GET',value,timeoutMs=20000){
  const r=await fetch(API+'/'+route,{method,headers:{'Content-Type':'application/json','x-worker-token':TOKEN},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(timeoutMs)});
  const b=await r.json().catch(()=>({error:'No server response'}));if(!r.ok)throw new Error(b.error||'Queue error');return b;
}
// Tells the app why the worker could not start, so the phone shows it instead of "Starting…" forever.
async function problem(message){
  console.error(message);
  await api('worker/problem','POST',{message:String(message).slice(0,400)}).catch(e=>console.error('Could not tell the app:',e.message));
}
if(LIVE&&!SUCCESS){await problem('Live mode is on (ALLOW_SUBMIT=1) but CONFIRMED_SUCCESS_TEXT is empty in worker\\.env.');process.exit(1)}
// The workplace site draws its page after loading, so wait for the control to appear before counting matches.
function fail(message){throw new Error(message)}
await mkdir(path.join(here,'browser-profile'),{recursive:true});
let context;
try{
  context=await chromium.launchPersistentContext(path.join(here,'browser-profile'),{channel:'msedge',headless:false,viewport:{width:1280,height:850},args:['--start-maximized']});
}catch(e){
  const m=String(e.message||e);
  await problem(/user data directory is already in use|ProcessSingleton|lock/i.test(m)
    ? 'The worker\'s Edge window is still open from before. Close every Edge window on the PC, then press Turn on the worker again.'
    : /executable doesn't exist|msedge|not found/i.test(m)
      ? 'Microsoft Edge could not be opened on the PC. Check that Edge is installed, then press Turn on the worker again.'
      : 'The worker could not open its browser: '+m.split('\n')[0]);
  process.exit(1);
}
// If the browser window is closed, stop. The startup task restarts the worker; nothing is claimed meanwhile.
context.on('close',()=>{console.error('Browser closed; worker stopping.');process.exit(1)});
let page=context.pages()[0]||await context.newPage();
// A slow or unreachable workplace site must not stop the worker; the loop below opens the page again.
await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(e=>console.error('Could not open the workplace page yet:',e.message));
console.log(`Ricotta worker opened ${PAGE}. Sign in to the workplace site in this Edge window if needed.`);
console.log(LIVE?'LIVE SUBMISSION ENABLED — only final-approved requests are submitted; only the exact configured success text counts as completed.':'DRY RUN — checks are reported to the phone, but no Move it click.');
let lastPageReady=null, lastRecovery=0, lastBeat=0;
// Health for the app: running, live or checks only, and whether the workplace transfer page is ready.
async function heartbeat(pageReady){
  if(Date.now()-lastBeat<HEARTBEAT_MS)return; lastBeat=Date.now();
  try{
    const r=await api('worker/heartbeat','POST',{live:LIVE,receiptsLive:RECEIPTS_LIVE,itemsLive:ITEMS_LIVE,pageReady,note:pageReady?'':(signinState.fails>=3?'Could not sign in to the workplace 3 times; sign in on the PC':'Workplace transfer page is not open or not signed in')});
    if(r?.checkSignin)signinState.requested=true;
  }catch{}
}
// Signing in to the workplace by itself. To protect the account it tries at most once every 10 minutes and
// stops after 3 failed tries (until a person presses "Check sign-in" in the app or restarts the worker).
const signinState={last:0,fails:0,requested:false};
async function signinReport(ok,auto,message){
  try{await api('worker/signin-report','POST',{ok,auto,message,image:await jpeg()})}catch(e){console.error('Could not report sign-in:',e.message)}
}
async function signinTurn(){
  const asked=signinState.requested; signinState.requested=false;
  const atLogin=await onLoginPage(page);
  if(!atLogin){
    if(!asked)return;
    // Asked by a person and already signed in: show the transfer page as proof.
    if(page.url()!==PAGE)await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{});
    if(await onLoginPage(page)){signinState.requested=true;return signinTurn();}
    const ok=await page.getByRole('heading',{name:/Move stock between storages/i}).isVisible({timeout:8000}).catch(()=>false);
    await signinReport(ok,false,ok?'Already signed in. The transfer page is open.':'Signed in, but the transfer page did not open.');
    return;
  }
  if(!asked&&(signinState.fails>=3||Date.now()-signinState.last<10*60_000))return;
  if(asked)signinState.fails=Math.min(signinState.fails,2);   // a person asking allows one more try
  signinState.last=Date.now();
  try{
    console.log('Workplace sign-in page is showing; signing in with the PIN keypad.');
    await signIn(page,WORKPLACE_PIN);
    signinState.fails=0;
    await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{});
    await page.getByRole('heading',{name:/Move stock between storages/i}).waitFor({state:'visible',timeout:15000}).catch(()=>{});
    console.log('Signed in to the workplace.');
    lastBeat=0;
    await signinReport(true,true,'The PC signed in to the workplace by itself.');
  }catch(e){
    signinState.fails++;
    console.error('Workplace sign-in failed:',e.message);
    await signinReport(false,true,`Could not sign in (${signinState.fails}/3): ${e.message}`);
  }
}
// A small JPEG of what the PC sees, sent to the phone so a person can confirm what was selected.
async function jpeg(){
  for(const quality of [55,35]){
    try{const b=(await page.screenshot({type:'jpeg',quality})).toString('base64');if(b.length<=560000)return b}catch{return undefined}
  }
  return undefined;
}
async function shot(id){try{const dir=path.join(here,'screenshots');await mkdir(dir,{recursive:true});
  await page.screenshot({path:path.join(dir,`${id}-${Date.now()}.png`),fullPage:true})}catch{}}
// Stage 2: only a request with a final approval on the phone is ever claimed and submitted.
async function execute(r){let clicked=false;
  try{
    const move=await inspectTransfer(page,r,SUCCESS);
    clicked=true;await move.click();
    await page.getByText(SUCCESS,{exact:true}).waitFor({state:'visible',timeout:12000});
    await page.getByRole('button',{name:'Move something else',exact:true}).waitFor({state:'visible',timeout:12000});
    if(await page.getByRole('button',{name:'Move it',exact:true}).isVisible().catch(()=>false))
      fail('Workplace form remained visible after success message');
    await api('worker/report','POST',{id:r.id,status:'completed',message:'Confirmed workplace success: '+SUCCESS,image:await jpeg()});
    console.log('Completed:',r.id);
    await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{}); // back to a clean form for the next request
  }catch(e){
    console.error('Stopped:',r.id,e.message);await shot(r.id);
    const status=clicked?'needs_checking':'failed';
    try{await api('worker/report','POST',{id:r.id,status,message:e.message,image:await jpeg()})}catch(reportError){console.error('Could not report result; it will need checking:',reportError.message)}
  }
}
// Stage 1: fill the form without clicking "Move it" and tell the phone whether everything matches.
async function preview(r){
  try{
    await inspectTransfer(page,r,SUCCESS);
    console.log('Check passed:',r.id);
    await api('worker/preview-report','POST',{id:r.id,ok:true,message:(r.lines&&r.lines.length>1?`All ${r.lines.length} items match`:'All match')+': storages, item, unit, amount and workplace stock.',image:await jpeg()});
  }catch(e){
    console.error('Check failed:',r.id,e.message);await shot(r.id);
    try{await api('worker/preview-report','POST',{id:r.id,ok:false,message:e.message,image:await jpeg()})}catch(reportError){console.error('Could not report check result:',reportError.message)}
  }
}
// Receipts get their own tab, so transfers keep working in the first one. The worker fills the
// receipt and leaves the tab for a person; it never presses "Receive & send to finance".
let rPage=null, held=null;   // held: the receipt filled in and left open on the PC
async function receiptShot(){
  if(!rPage||rPage.isClosed())return undefined;
  for(const quality of [50,30]){try{const b=(await rPage.screenshot({type:'jpeg',quality,fullPage:true})).toString('base64');if(b.length<=560000)return b}catch{return undefined}}
  return undefined;
}
async function resetReceiptTab(){if(rPage&&!rPage.isClosed())await rPage.goto(RECEIPT_PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{})}
async function receiptTurn(){
  if(held){
    const r=held, st=await api('worker/receipt-held','POST',{id:r.id});
    if(st.status==='cancelled'){held=null;await resetReceiptTab();console.log('Receipt cancelled from the app; form cleared:',r.id);return}
    // Finished or left on the PC by a person: a person confirms in the app whether it was saved.
    const open=rPage&&!rPage.isClosed()&&rPage.url().startsWith(RECEIPT_PAGE)&&await rPage.getByRole('button',{name:'Receive & send to finance',exact:true}).isVisible().catch(()=>false);
    if(!open){
      held=null;
      await api('worker/receipt-report','POST',{id:r.id,claimToken:r.claimToken,status:'closed',message:'The receipt was finished or left on the PC without the app. Check the workplace receipts and confirm in the app.',image:await receiptShot()}).catch(e=>console.error('Could not report receipt:',e.message));
      return;
    }
    if(st.status!=='prepared'||!st.finalApproved||!RECEIPTS_LIVE)return;
    if(!(await api('worker/receipt-submit-claim','POST',{id:r.id})).ok)return;
    held=null; let pressed=false;
    try{
      await rPage.bringToFront().catch(()=>{});
      await submitReceipt(rPage,r,RECEIPT_SUCCESS,()=>{pressed=true});
      await api('worker/receipt-finish','POST',{id:r.id,status:'completed',message:'Confirmed workplace success: '+RECEIPT_SUCCESS,image:await receiptShot()});
      console.log('Receipt saved in the workplace:',r.id);
    }catch(e){
      console.error('Receipt stopped:',r.id,e.message);
      // After the press nothing is retried: a person checks the workplace and confirms in the app.
      await api('worker/receipt-finish','POST',{id:r.id,status:pressed?'needs_checking':'failed',message:e.message,image:await receiptShot()}).catch(err=>console.error('Could not report receipt; it will need checking:',err.message));
    }
    if(!pressed)await resetReceiptTab();
    return;
  }
  const r=(await api('worker/receipt-claim','POST',{})).receipt;
  if(!r)return;
  console.log('Preparing receipt:',r.id,r.supplierName,r.invoice);
  try{
    if(!rPage||rPage.isClosed())rPage=await context.newPage();
    await prepareReceipt(rPage,r);
    await rPage.bringToFront().catch(()=>{});
    held=r;
    await api('worker/receipt-report','POST',{id:r.id,claimToken:r.claimToken,status:'prepared',message:'Filled in on the PC and checked. Waiting for the final approval in the app.',image:await receiptShot()});
    console.log('Receipt filled in and waiting for the final approval:',r.id);
  }catch(e){
    held=null;
    console.error('Receipt stopped:',r.id,e.message);
    const image=await receiptShot();
    await resetReceiptTab();
    await api('worker/receipt-report','POST',{id:r.id,claimToken:r.claimToken,status:'failed',message:e.message,image}).catch(err=>console.error('Could not report receipt:',err.message));
  }
}
// Ingredient tasks (create / edit in the workplace) get a third tab and follow the same rules as receipts.
let iPage=null, heldItem=null;
async function itemShot(){
  if(!iPage||iPage.isClosed())return undefined;
  for(const quality of [50,30]){try{const b=(await iPage.screenshot({type:'jpeg',quality,fullPage:true})).toString('base64');if(b.length<=560000)return b}catch{return undefined}}
  return undefined;
}
async function resetItemTab(){if(iPage&&!iPage.isClosed())await iPage.goto(STOCK_PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{})}
async function itemTurn(){
  if(heldItem){
    const j=heldItem, st=await api('worker/itemjob-held','POST',{id:j.id});
    if(st.status==='cancelled'){heldItem=null;await resetItemTab();console.log('Item task cancelled from the app; form closed:',j.id);return}
    const open=iPage&&!iPage.isClosed()&&iPage.url().startsWith(STOCK_PAGE)&&await formOpen(iPage,j).catch(()=>false);
    if(!open){
      heldItem=null;
      await api('worker/itemjob-report','POST',{id:j.id,claimToken:j.claimToken,status:'closed',message:'The form was saved or closed on the PC without the app. Check the workplace and confirm in the app.',image:await itemShot()}).catch(e=>console.error('Could not report item task:',e.message));
      return;
    }
    if(st.status!=='prepared'||!st.finalApproved||!ITEMS_LIVE)return;
    if(!(await api('worker/itemjob-submit-claim','POST',{id:j.id})).ok)return;
    heldItem=null; let pressed=false;
    try{
      await iPage.bringToFront().catch(()=>{});
      await submitItem(iPage,j,ITEM_SUCCESS[j.kind],()=>{pressed=true});
      await api('worker/itemjob-finish','POST',{id:j.id,status:'completed',message:'Confirmed workplace success: '+ITEM_SUCCESS[j.kind],image:await itemShot()});
      console.log('Item saved in the workplace:',j.id);
    }catch(e){
      console.error('Item task stopped:',j.id,e.message);
      await api('worker/itemjob-finish','POST',{id:j.id,status:pressed?'needs_checking':'failed',message:e.message,image:await itemShot()}).catch(err=>console.error('Could not report item task; it will need checking:',err.message));
    }
    if(!pressed)await resetItemTab();
    return;
  }
  const j=(await api('worker/itemjob-claim','POST',{})).job;
  if(!j)return;
  console.log('Preparing item task:',j.id,j.kind,j.name);
  try{
    if(!iPage||iPage.isClosed())iPage=await context.newPage();
    await prepareItem(iPage,j);
    await iPage.bringToFront().catch(()=>{});
    heldItem=j;
    await api('worker/itemjob-report','POST',{id:j.id,claimToken:j.claimToken,status:'prepared',message:'Filled in on the PC and checked. Waiting for the final approval in the app.',image:await itemShot()});
  }catch(e){
    heldItem=null;
    console.error('Item task stopped:',j.id,e.message);
    const image=await itemShot();
    await resetItemTab();
    await api('worker/itemjob-report','POST',{id:j.id,claimToken:j.claimToken,status:'failed',message:e.message,image}).catch(err=>console.error('Could not report item task:',err.message));
  }
}
// checkQueue: look for work this turn. It is off after a quiet wait, so a quiet PC makes one call per wait.
let checkQueue=true;
while(true){
  let busy=false;
  try{
    const pageReady=page.url()===PAGE && await page.getByRole('heading',{name:/Move stock between storages/i}).isVisible().catch(()=>false);
    if(pageReady!==lastPageReady){
      console.log(pageReady?'Workplace transfer form is visible.':'Workplace transfer form is not visible; sign in or return to the transfer page.');
      lastPageReady=pageReady; lastBeat=0;   // tell the app straight away
    }
    await heartbeat(pageReady);
    // Signed out (or a person asked for a check): sign in first, so every command runs on a signed-in site.
    if(!pageReady||signinState.requested)await signinTurn();
    // Without a visible transfer form nothing is claimed or checked; requests keep waiting.
    // Try to return to the page at most once a minute (for example after a sign-in redirect).
    if(!pageReady&&Date.now()-lastRecovery>60000){lastRecovery=Date.now();await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{})}
    else if(pageReady&&(checkQueue||held||heldItem)){
      const claimed=LIVE?(await api('worker/claim?multi=1','POST',{})).request:null;
      if(claimed){busy=true;await execute(claimed)}
      else{const next=(await api('worker/preview?multi=1')).request;if(next){busy=true;await preview(next)}else{await receiptTurn();await itemTurn();busy=!!held||!!heldItem}}
    }
  }catch(e){console.error('Queue unavailable; no transfer will run:',e.message)}
  if(busy||!lastPageReady){await sleep(POLL);checkQueue=true;continue}
  // Woken, but nothing could be picked up (for example an approved transfer while the PC is in test mode):
  // pause like before, so the question is never asked in a tight loop.
  if(checkQueue)await sleep(POLL);
  // Nothing to do: wait for the server to say there is (answered within a second of new work).
  checkQueue=await waitForWork(()=>api('worker/wait?multi=1&live='+(LIVE?1:0),'GET',undefined,WAIT_TIMEOUT_MS),sleep);
  if(checkQueue)lastBeat=0;   // a sign-in check may have been asked for: the heartbeat answers it straight away
}
