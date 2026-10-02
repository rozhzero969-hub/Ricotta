// Deliberately conservative browser worker: semantic controls, visible checks,
// no coordinate clicks, no automatic retry after a click, and dry-run by default.
import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareReceipt, submitReceipt, RECEIPT_PAGE } from './receipt.mjs';
import { prepareItem, submitItem, formOpen, STOCK_PAGE } from './items.mjs';
import {nextPollDelay} from './polling.mjs';
import { acquireLock } from './lock.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const PAGE='https://pos.shaydattendance.com/inventory/transfer';
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
if(TOKEN.length<32)throw new Error('Set WORKER_TOKEN in worker/.env');
if(LIVE&&!SUCCESS)throw new Error('Live submission requires CONFIRMED_SUCCESS_TEXT');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Only one worker may drive the workplace page. A lock is recovered only after
// its process has exited; an old heartbeat alone never permits another driver.
const LOCK=path.join(here,'worker.lock');
const workerLock=acquireLock(LOCK);
if(!workerLock.acquired){console.error(`${workerLock.reason}${workerLock.held?.pid?` (process ${workerLock.held.pid})`:''}`);process.exit(0)}
process.on('exit',()=>{try{workerLock.release()}catch{}});
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>process.exit(0));
setInterval(()=>{try{workerLock.heartbeat()}catch(error){console.error(error.message);process.exit(1)}},30000).unref();
async function api(route,method='GET',value){
  const r=await fetch(API+'/'+route,{method,headers:{'Content-Type':'application/json','x-worker-token':TOKEN},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(20000)});
  const b=await r.json().catch(()=>({error:'No server response'}));if(!r.ok)throw new Error(b.error||'Queue error');return b;
}
// The workplace site draws its page after loading, so wait for the control to appear before counting matches.
async function one(locator,label){await locator.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});const count=await locator.count();if(count!==1)throw new Error(`${label}: expected one visible match, found ${count}`);if(!await locator.isVisible())throw new Error(`${label}: hidden`);return locator}
function fail(message){throw new Error(message)}
async function pickByText(page,button,choice,label){
  await (await one(button,label+' picker')).click();
  const option=page.getByRole('option',{name:choice,exact:true});
  await (await one(option,label+' option '+choice)).click();
  if((await button.innerText()).trim()!==choice)fail(`${label} did not stay selected`);
}
async function inspect(page,r){
  if(page.url()!==PAGE)fail('Workplace browser is not on the approved transfer page');
  await page.keyboard.press('Control+0'); // browser zoom = 100%
  await one(page.getByRole('heading',{name:/Move stock between storages/i}),'transfer page heading');
  const textSize=await one(page.getByRole('button',{name:'Reset text size'}),'text size');
  if((await textSize.innerText()).replace(/\s/g,'')!=='100%')await textSize.click();
  if((await textSize.innerText()).replace(/\s/g,'')!=='100%')fail('Page text size is not 100%');
  if(!r.from||!r.to||r.from===r.to)fail('Invalid storages');
  if(!r.itemName||!r.unitLabel||!(Number.isFinite(r.quantity)&&r.quantity>0))fail('The request is missing its item, unit or quantity');
  // A fresh navigation clears any form left from a prior preview or error.
  await page.goto(PAGE,{waitUntil:'domcontentloaded'});
  await one(page.getByRole('heading',{name:/Move stock between storages/i}),'transfer page heading');
  await pickByText(page,page.getByRole('button',{name:'From storage',exact:true}),r.from,'source');
  await pickByText(page,page.getByRole('button',{name:'To storage',exact:true}),r.to,'destination');
  const yesterday=await one(page.getByRole('button',{name:/Record for yesterday/i}),'yesterday toggle');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))await yesterday.click();
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))fail('Yesterday setting did not stay selected');
  const rows=itemRows(page);
  if(await rows.count()!==1)fail(`Expected 1 ingredient row; saw ${await rows.count()}`);
  const row=rows.nth(0);
  const itemButton=row.getByRole('button',{name:/Choose an ingredient/i});
  await (await one(itemButton,'ingredient picker')).click();
  const searches=page.getByRole('textbox',{name:/Search items/i});
  if(await searches.count()===1)await searches.fill(r.itemName);
  const candidates=page.getByRole('option').filter({has:page.getByText(r.itemName,{exact:true})});
  const n=await candidates.count();
  if(n!==1)fail(`Item ${r.itemName} is ambiguous or absent on the workplace page (${n} matches). Its name in Ricotta must match exactly.`);
  await candidates.click();
  await one(row.getByRole('button',{name:r.itemName,exact:true}),'selected item name');
  const unitButton=row.getByRole('button',{name:'Unit',exact:true});
  await (await one(unitButton,'unit picker')).click();
  await (await one(page.getByRole('option',{name:r.unitLabel,exact:true}),'unit option '+r.unitLabel)).click();
  if((await unitButton.innerText()).trim()!==r.unitLabel)fail('Selected unit did not match request');
  const amount=await one(row.getByRole('textbox',{name:'amount'}),'amount');
  await amount.fill(String(r.quantity));
  if(Number(await amount.inputValue())!==Number(r.quantity))fail('Amount did not remain exact');
  // A stock check is intentionally mandatory: the app's own count in the source storage
  // (already in the counting unit) must equal what the workplace page shows.
  const availableText=(await row.innerText()).split('\n').find(s=>s.includes('available in '+r.from));
  if(!availableText)fail('Workplace available stock was not visible');
  const match=availableText.trim().match(/^([\d,]+(?:\.\d+)?)\s+(.+?)\s+available in\s+/i);
  if(!match||match[2].trim()!==r.unitLabel)fail('Workplace stock unit could not be checked');
  const workplace=Number(match[1].replaceAll(',',''));
  // The app's stock is already converted into the unit being moved (2 boxes, not 24 pieces). The page shows
  // a rounded number (19.81), so compare at the precision it displays; a whole number must match exactly.
  const app=Number(r.appQuantity);
  const shown=(match[1].split('.')[1]||'').length;
  const tolerance=shown>0?0.5*Math.pow(10,-shown)+1e-9:1e-6;
  if(!Number.isFinite(workplace)||!Number.isFinite(app)||Math.abs(workplace-app)>tolerance)fail(`Stock mismatch for ${r.itemName}: workplace ${workplace}, app ${Math.round(app*1e6)/1e6} ${r.unitLabel}. Recount it in Stock, and check the unit conversion matches the workplace system.`);
  if(workplace<Number(r.quantity))fail(`Insufficient workplace stock for ${r.itemName}`);
  if(await rowsOnPage(page)!==1)fail('Unexpected number of form rows');
  // The workplace now focuses the amount box as soon as an item is picked. Read the whole row back once more
  // right before the button, so nothing typed or changed by that focus can slip through.
  if(await row.getByRole('button',{name:r.itemName,exact:true}).count()!==1)fail('Selected item changed before submission');
  if((await unitButton.innerText()).trim()!==r.unitLabel)fail('Selected unit changed before submission');
  if(await row.getByRole('textbox',{name:'amount'}).count()!==1||Number(await amount.inputValue())!==Number(r.quantity))fail('Amount changed before submission');
  if(page.url()!==PAGE)fail('Workplace page changed before submission');
  if((await page.getByRole('button',{name:'From storage',exact:true}).innerText()).trim()!==r.from ||
    (await page.getByRole('button',{name:'To storage',exact:true}).innerText()).trim()!==r.to)
    fail('Storage selection changed before submission');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))fail('Yesterday setting changed before submission');
  const move=await one(page.getByRole('button',{name:'Move it',exact:true}),'submit button');
  if(!await move.isEnabled())fail('Submit button is disabled');
  if(SUCCESS&&await page.getByText(SUCCESS,{exact:true}).count())fail('Success text was already present before submission');
  return move;
}
// An item row shows only "Choose an ingredient" until an item is picked; the amount box appears afterwards.
const itemRows=page=>page.locator('div.rounded-xl.border.p-3').filter({has:page.getByRole('button',{name:/Choose an ingredient/i}).or(page.getByRole('textbox',{name:'amount'}))});
async function rowsOnPage(page){return itemRows(page).count()}
await mkdir(path.join(here,'browser-profile'),{recursive:true});
const context=await chromium.launchPersistentContext(path.join(here,'browser-profile'),{channel:'msedge',headless:false,viewport:{width:1280,height:850},args:['--start-maximized']});
// If the browser window is closed, stop. The startup task restarts the worker; nothing is claimed meanwhile.
context.on('close',()=>{console.error('Browser closed; worker stopping.');process.exit(1)});
let page=context.pages()[0]||await context.newPage();
await page.goto(PAGE,{waitUntil:'domcontentloaded'});
console.log(`Ricotta worker opened ${PAGE}. Sign in to the workplace site in this Edge window if needed.`);
console.log(LIVE?'LIVE SUBMISSION ENABLED — only final-approved requests are submitted; only the exact configured success text counts as completed.':'DRY RUN — checks are reported to the phone, but no Move it click.');
let lastPageReady=null, lastRecovery=0, lastBeat=0;
// Health for the app: running, live or checks only, and whether the workplace transfer page is ready.
async function heartbeat(pageReady){
  if(Date.now()-lastBeat<30000)return; lastBeat=Date.now();
  try{await api('worker/heartbeat','POST',{live:LIVE,receiptsLive:RECEIPTS_LIVE,itemsLive:ITEMS_LIVE,pageReady,note:pageReady?'':'Workplace transfer page is not open or not signed in'})}catch{}
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
    const move=await inspect(page,r);
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
    await inspect(page,r);
    console.log('Check passed:',r.id);
    await api('worker/preview-report','POST',{id:r.id,ok:true,message:'All match: storages, item, unit, amount and workplace stock.',image:await jpeg()});
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
let pollDelay=POLL;
while(true){
  let busy=false;
  try{
    const pageReady=page.url()===PAGE && await page.getByRole('heading',{name:/Move stock between storages/i}).isVisible().catch(()=>false);
    if(pageReady!==lastPageReady){
      console.log(pageReady?'Workplace transfer form is visible.':'Workplace transfer form is not visible; sign in or return to the transfer page.');
      lastPageReady=pageReady; lastBeat=0;   // tell the app straight away
    }
    await heartbeat(pageReady);
    // Without a visible transfer form nothing is claimed or checked; requests keep waiting.
    // Try to return to the page at most once a minute (for example after a sign-in redirect).
    if(!pageReady&&Date.now()-lastRecovery>60000){lastRecovery=Date.now();await page.goto(PAGE,{waitUntil:'domcontentloaded'}).catch(()=>{})}
    else if(pageReady){
      const claimed=LIVE?(await api('worker/claim','POST',{})).request:null;
      if(claimed){busy=true;await execute(claimed)}
      else{const next=(await api('worker/preview')).request;if(next){busy=true;await preview(next)}else{await receiptTurn();await itemTurn();busy=!!held||!!heldItem}}
    }
  }catch(e){console.error('Queue unavailable; no transfer will run:',e.message)}
  pollDelay=nextPollDelay(pollDelay,busy,POLL);
  await sleep(pollDelay);
}
