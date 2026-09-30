// Deliberately conservative browser worker: semantic controls, visible checks,
// no coordinate clicks, no automatic retry after a click, and dry-run by default.
import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const PAGE='https://pos.shaydattendance.com/inventory/transfer';
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/transfer-api';
const TOKEN=process.env.WORKER_TOKEN||'';
const LIVE=process.env.ALLOW_SUBMIT==='1';
const SUCCESS=(process.env.CONFIRMED_SUCCESS_TEXT||'').trim();
const POLL=Math.max(5,Number(process.env.POLL_SECONDS)||5)*1000;
if(TOKEN.length<32)throw new Error('Set WORKER_TOKEN in worker/.env');
if(LIVE&&!SUCCESS)throw new Error('Live submission requires CONFIRMED_SUCCESS_TEXT');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',value){
  const r=await fetch(API+'/'+route,{method,headers:{'Content-Type':'application/json','x-worker-token':TOKEN},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(20000)});
  const b=await r.json().catch(()=>({error:'No server response'}));if(!r.ok)throw new Error(b.error||'Queue error');return b;
}
async function one(locator,label){const count=await locator.count();if(count!==1)throw new Error(`${label}: expected one visible match, found ${count}`);if(!await locator.isVisible())throw new Error(`${label}: hidden`);return locator}
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
  if(!r.from_storage||!r.to_storage||r.from_storage===r.to_storage)fail('Invalid storages');
  const lines=r.lines||[];if(!lines.length||lines.length>20)fail('Invalid line count');
  // A fresh navigation clears any form left from a prior preview or error.
  await page.goto(PAGE,{waitUntil:'domcontentloaded'});
  await one(page.getByRole('heading',{name:/Move stock between storages/i}),'transfer page heading');
  await pickByText(page,page.getByRole('button',{name:'From storage',exact:true}),r.from_storage,'source');
  await pickByText(page,page.getByRole('button',{name:'To storage',exact:true}),r.to_storage,'destination');
  const yesterday=await one(page.getByRole('button',{name:/Record for yesterday/i}),'yesterday toggle');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.record_yesterday?'true':'false'))await yesterday.click();
  if((await yesterday.getAttribute('aria-pressed'))!==(r.record_yesterday?'true':'false'))fail('Yesterday setting did not stay selected');
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(i>0)await (await one(page.getByRole('button',{name:/Add another item/i}),'add item')).click();
    const rows=page.locator('div.rounded-xl.border.p-3').filter({has:page.getByRole('textbox',{name:'amount'})});
    if(await rows.count()!==i+1)fail(`Expected ${i+1} ingredient rows; saw ${await rows.count()}`);
    const row=rows.nth(i);
    const itemButton=row.getByRole('button',{name:/Choose an ingredient/i});
    await (await one(itemButton,'ingredient picker')).click();
    const searches=page.getByRole('textbox',{name:/Search items/i});
    if(await searches.count()===1)await searches.fill(line.exact_name);
    const candidates=page.getByRole('option').filter({has:page.getByText(line.exact_name,{exact:true})});
    const n=await candidates.count();
    if(n!==1)fail(`Item ${line.exact_name} is ambiguous or absent (${n} matches)`);
    await candidates.click();
    await one(row.getByRole('button',{name:line.exact_name,exact:true}),'selected item name');
    const unitButton=row.getByRole('button',{name:'Unit',exact:true});
    await (await one(unitButton,'unit picker')).click();
    await (await one(page.getByRole('option',{name:line.unit,exact:true}),'unit option')).click();
    if((await unitButton.innerText()).trim()!==line.unit)fail('Selected unit did not match request');
    const amount=await one(row.getByRole('textbox',{name:'amount'}),'amount');
    await amount.fill(String(line.quantity));
    if(Number(await amount.inputValue())!==Number(line.quantity))fail('Amount did not remain exact');
    const expected=await api('worker/balance?item='+encodeURIComponent(line.item_id)+'&storage='+encodeURIComponent(r.from_storage));
    // A stock check is intentionally mandatory. The endpoint returns the current
    // app ledger in counting units; the visible page supplies the POS balance.
    const availableText=(await row.innerText()).split('\n').find(s=>s.includes('available in '+r.from_storage));
    if(!availableText)fail('Workplace available stock was not visible');
    const match=availableText.trim().match(/^([\d,]+(?:\.\d+)?)\s+(.+?)\s+available in\s+/i);
    if(!match||match[2].trim()!==line.unit)fail('Workplace stock unit could not be checked');
    const workplace=Number(match[1].replaceAll(',',''));
    const app=Number(expected.quantity)/Number(line.count_per_unit);
    if(!Number.isFinite(workplace)||Math.abs(workplace-app)>0.000001)fail(`Stock mismatch for ${line.exact_name}: workplace ${workplace}, app ${app} ${line.unit}`);
    if(workplace<Number(line.quantity))fail(`Insufficient workplace stock for ${line.exact_name}`);
  }
  if(await rowsOnPage(page)!==lines.length)fail('Unexpected number of form rows');
  if(page.url()!==PAGE)fail('Workplace page changed before submission');
  if((await page.getByRole('button',{name:'From storage',exact:true}).innerText()).trim()!==r.from_storage ||
    (await page.getByRole('button',{name:'To storage',exact:true}).innerText()).trim()!==r.to_storage)
    fail('Storage selection changed before submission');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.record_yesterday?'true':'false'))fail('Yesterday setting changed before submission');
  const move=await one(page.getByRole('button',{name:'Move it',exact:true}),'submit button');
  if(!await move.isEnabled())fail('Submit button is disabled');
  if(SUCCESS&&await page.getByText(SUCCESS,{exact:false}).count())fail('Success text was already present before submission');
  return move;
}
async function rowsOnPage(page){return page.locator('div.rounded-xl.border.p-3').filter({has:page.getByRole('textbox',{name:'amount'})}).count()}
await mkdir(path.join(here,'browser-profile'),{recursive:true});
const context=await chromium.launchPersistentContext(path.join(here,'browser-profile'),{channel:'msedge',headless:false,viewport:{width:1280,height:850},args:['--start-maximized']});
let page=context.pages()[0]||await context.newPage();
await page.goto(PAGE,{waitUntil:'domcontentloaded'});
console.log(`Ricotta worker opened ${PAGE}. Sign in to the workplace site in this Edge window if needed.`);
console.log(LIVE?'LIVE SUBMISSION ENABLED — only exact configured success text counts as completed.':'DRY RUN — requests stay Waiting; no Move it click.');
while(true){
  try{
    const response=LIVE?await api('worker/claim','POST',{}):await api('worker/preview');
    if(response.request){
      const r=response.request;
      if(r){let clicked=false;
        try{
          const move=await inspect(page,r);
          if(!LIVE){console.log('Dry run passed:',r.id);}
          else{
            clicked=true;await move.click();
            await page.getByText(SUCCESS,{exact:false}).waitFor({state:'visible',timeout:12000});
            await api('worker/report','POST',{id:r.id,status:'completed',message:'Confirmed workplace success: '+SUCCESS});
            console.log('Completed:',r.id);
          }
        }catch(e){
          console.error('Stopped:',r.id,e.message);
          try{const dir=path.join(here,'screenshots');await mkdir(dir,{recursive:true});
            await page.screenshot({path:path.join(dir,`${r.id}-${Date.now()}.png`),fullPage:true});
          }catch{}
          if(LIVE){const status=clicked?'needs_checking':'failed';try{await api('worker/report','POST',{id:r.id,status,message:e.message})}catch(reportError){console.error('Could not report result; it will need checking:',reportError.message)}}
        }
      }
    }
  }catch(e){console.error('Queue unavailable; no transfer will run:',e.message)}
  await sleep(POLL);
}
