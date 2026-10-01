// Deliberately conservative browser worker: semantic controls, visible checks,
// no coordinate clicks, no automatic retry after a click, and dry-run by default.
import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const PAGE='https://pos.shaydattendance.com/inventory/transfer';
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/stock-api';
const TOKEN=process.env.WORKER_TOKEN||'';
const LIVE=process.env.ALLOW_SUBMIT==='1';
const SUCCESS=(process.env.CONFIRMED_SUCCESS_TEXT||'').trim();
const POLL=Math.max(5,Number(process.env.POLL_SECONDS)||5)*1000;
if(TOKEN.length<32)throw new Error('Set WORKER_TOKEN in worker/.env');
if(LIVE&&!SUCCESS)throw new Error('Live submission requires CONFIRMED_SUCCESS_TEXT');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Only one worker may drive the workplace page. The lock file carries a heartbeat,
// so a lock left by a crash or reboot goes stale and cannot block startup forever.
const LOCK=path.join(here,'worker.lock');
const lockBody=()=>JSON.stringify({pid:process.pid,at:Date.now()});
async function takeLock(){
  try{await writeFile(LOCK,lockBody(),{flag:'wx'});return}catch(e){if(e.code!=='EEXIST')throw e}
  const held=JSON.parse(await readFile(LOCK,'utf8').catch(()=>'{}')||'{}');
  let alive=false;
  if(held.pid>0&&held.pid!==process.pid&&Date.now()-Number(held.at)<90000){try{process.kill(held.pid,0);alive=true}catch(e){alive=e.code==='EPERM'}}
  if(alive){console.error(`Another Ricotta worker is already running (process ${held.pid}). Exiting so only one instance drives the workplace page.`);process.exit(0)}
  await writeFile(LOCK,lockBody());
}
function releaseLock(){try{rmSync(LOCK,{force:true})}catch{}}
await takeLock();
process.on('exit',releaseLock);
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>process.exit(0));
setInterval(()=>writeFile(LOCK,lockBody()).catch(()=>{}),30000).unref();
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
  if(!r.itemName||!r.unitLabel||!(Number(r.quantity)>0))fail('The request is missing its item, unit or quantity');
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
  if(!Number.isFinite(workplace)||Math.abs(workplace-app)>tolerance)fail(`Stock mismatch for ${r.itemName}: workplace ${workplace}, app ${Math.round(app*1e6)/1e6} ${r.unitLabel}. Recount it in Stock, and check the unit conversion matches the workplace system.`);
  if(workplace<Number(r.quantity))fail(`Insufficient workplace stock for ${r.itemName}`);
  if(await rowsOnPage(page)!==1)fail('Unexpected number of form rows');
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
  try{await api('worker/heartbeat','POST',{live:LIVE,pageReady,note:pageReady?'':'Workplace transfer page is not open or not signed in'})}catch{}
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
while(true){
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
      if(claimed)await execute(claimed);
      else{const next=(await api('worker/preview')).request;if(next)await preview(next)}
    }
  }catch(e){console.error('Queue unavailable; no transfer will run:',e.message)}
  await sleep(POLL);
}
