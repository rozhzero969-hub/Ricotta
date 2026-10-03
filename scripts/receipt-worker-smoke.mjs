// Runs the PC worker's receipt filler against a local copy of the workplace "New purchase receipt"
// page (scripts/fixtures/new-receipt.html) and checks it fills every field, refuses anything unclear,
// and never presses "Receive & send to finance". Run: node scripts/receipt-worker-smoke.mjs
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareReceipt, submitReceipt, RECEIPT_PAGE} from '../worker/receipt.mjs';
import {loseClickResponse} from './worker-test-helpers.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const html=readFileSync(path.join(here,'fixtures/new-receipt.html'),'utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
const ctx=await browser.newContext({viewport:{width:1280,height:850}});
await ctx.route(RECEIPT_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
const page=await ctx.newPage();
const base={supplierName:'Fresh Foods',invoice:'INV-1024',currency:'IQD',rate:null,delivery:null};
try{
  // 1. A full receipt: dollars, delivery, two items, units with a "(×N)" multiplier, duplicates of the same unit.
  await prepareReceipt(page,{...base,currency:'USD',rate:1500,delivery:5000,lines:[
    {workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:10,cost:10},
    {workplaceName:'Blueberry Ice Cream - ئایس کریمی بلوبێری',unitLabel:'پاکەت',qty:5,cost:2000}]});
  const v=await page.evaluate(()=>({sup:document.getElementById('sup').textContent,inv:document.getElementById('inv').value,
    rate:document.querySelector('#rateBox input')?.value,del:document.querySelector('#delBox input')?.value,
    rows:[...document.querySelectorAll('.row')].map(r=>[r.querySelector('.it').textContent,r.querySelector('.un').textContent,...[...r.querySelectorAll('input')].map(i=>i.value),r.querySelector('.tot').textContent]),
    submitted:window.submitted}));
  assert.deepEqual(v,{sup:'Fresh Foods',inv:'INV-1024',rate:'1500',del:'5000',rows:[
    ['Tomato - تەماتە','کیلۆ (×1000)','10','10','$ 100'],
    ['Blueberry Ice Cream - ئایس کریمی بلوبێری','پاکەت (×3000)','5','2000','$ 10,000']],submitted:0});
  // 1b. A two-language supplier name whose Kurdish half uses a look-alike letter in the workplace: typing the
  // whole name finds nothing there, so the worker types "Golden Bread Bakery" and matches the full name.
  await prepareReceipt(page,{...base,supplierName:'Golden Bread Bakery / صمون گۆلدن برید',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:2,cost:500}]});
  assert.equal(await page.evaluate(()=>document.getElementById('sup').textContent),'Golden Bread Bakery / صمون گۆلدن بريد');
  // 1c. A freshly opened tab: the lists arrive 2.5 seconds late and "No suppliers found" shows until then.
  // The worker waits for the real choices instead of giving up.
  const lateCtx=await browser.newContext({viewport:{width:1280,height:850}});
  await lateCtx.addInitScript(()=>{window.__listsDelay=2500});
  await lateCtx.route(RECEIPT_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
  const latePage=await lateCtx.newPage();
  await prepareReceipt(latePage,{...base,lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:2,cost:500}]});
  assert.equal(await latePage.evaluate(()=>document.getElementById('sup').textContent),'Fresh Foods','supplier picked after the list loaded late');
  await lateCtx.close();
  // 1d. The real page: the invoice number, dollar rate, delivery, quantity and cost are read-only boxes that open the
  // page's own number pad (no decimal point). The worker presses the keys and Enter, and reads every box back.
  const padPage=async(decimal=false)=>{
    const c=await browser.newContext({viewport:{width:1280,height:850}});
    await c.addInitScript(d=>{window.__pads=true;window.__padDecimal=d},decimal);
    await c.route(RECEIPT_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
    return {c,p:await c.newPage()};
  };
  {
    const {c,p}=await padPage();
    await prepareReceipt(p,{...base,invoice:'2546',currency:'USD',rate:1500,delivery:5000,lines:[
      {workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:10,cost:10},
      {workplaceName:'Blueberry Ice Cream - ئایس کریمی بلوبێری',unitLabel:'پاکەت',qty:5,cost:2000}]});
    const pv=await p.evaluate(()=>({inv:document.getElementById('inv').value,rate:document.querySelector('#rateBox input')?.value,del:document.querySelector('#delBox input')?.value,
      rows:[...document.querySelectorAll('.row')].map(r=>[...r.querySelectorAll('input')].map(i=>i.value)),readonly:document.getElementById('inv').readOnly,submitted:window.submitted}));
    assert.deepEqual(pv,{inv:'2546',rate:'1500',del:'5000',rows:[['10','10'],['5','2000']],readonly:true,submitted:0},'number-pad boxes filled by pressing the keys');
    // Entering a box that already has a number clears it first (a second receipt on the same page).
    await prepareReceipt(p,{...base,invoice:'77',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:3,cost:500}]});
    assert.equal(await p.evaluate(()=>document.getElementById('inv').value),'77');
    // Things the pad cannot type are refused clearly, not typed wrongly.
    await assert.rejects(prepareReceipt(p,{...base,invoice:'INV-9',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:1,cost:1}]}),/Invoice number: "INV-9" cannot be entered/);
    await assert.rejects(prepareReceipt(p,{...base,invoice:'1024',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:1.5,cost:1}]}),/number pad has no "\."/);
    assert.equal(await p.evaluate(()=>window.submitted),0);
    await c.close();
  }
  {
    const {c,p}=await padPage(true);
    await prepareReceipt(p,{...base,invoice:'8',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:1.5,cost:1000}]});
    assert.deepEqual(await p.evaluate(()=>[...document.querySelector('.row').querySelectorAll('input')].map(i=>i.value)),['1.5','1000'],'a pad with a decimal point types decimals');
    await c.close();
  }
  // 2. Stops on anything unclear, and never submits.
  const stops=async(r,re,why)=>{await assert.rejects(prepareReceipt(page,{...base,...r}),re,why);assert.equal(await page.evaluate(()=>window.submitted),0)};
  await stops({lines:[{workplaceName:'Tomatoes',unitLabel:'کیلۆ',qty:1,cost:1}]},/no choice matches/,'an item that is not on the list');
  await stops({lines:[{workplaceName:'Odd Item',unitLabel:'دانە',qty:1,cost:1}]},/more than one possible choice/,'a unit with two different sizes');
  await stops({supplierName:'Nobody',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:1,cost:1}]},/Supplier: no choice/,'an unknown supplier');
  await stops({lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'سندوق',qty:1,cost:1}]},/Unit "سندوق"/,'a unit the item does not have');
  // 3. Saving after the final approval: a form changed in between is never submitted.
  const good={...base,lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:10,cost:1000}]};
  await prepareReceipt(page,good);
  await page.locator('.row input').first().fill('11');
  let pressed=false;
  await assert.rejects(submitReceipt(page,good,'Receipt received',()=>{pressed=true}),/quantity changed/,'an edited quantity stops it');
  assert.equal(pressed,false);assert.equal(await page.evaluate(()=>window.submitted),0,'nothing pressed when the form changed');
  // A negative/malformed readback cannot become positive just by dropping characters.
  for(const changed of ['-10','10oops','1,0','']){
    await prepareReceipt(page,good);pressed=false;
    await page.locator('.row input').first().fill(changed);
    await assert.rejects(submitReceipt(page,good,'Receipt received',()=>{pressed=true}),/quantity changed/);
    assert.equal(pressed,false);assert.equal(await page.evaluate(()=>window.submitted),0);
  }
  // No success message configured: never pressed.
  await prepareReceipt(page,good);
  await assert.rejects(submitReceipt(page,good,'',()=>{pressed=true}),/No receipt success message/);
  assert.equal(await page.evaluate(()=>window.submitted),0);
  // The right form and the exact success message: pressed exactly once.
  await submitReceipt(page,good,'Receipt received',()=>{pressed=true});
  assert.equal(pressed,true);assert.equal(await page.evaluate(()=>window.submitted),1,'pressed once');
  // Pressed but the success message never appears: reported as an error after the press (needs checking).
  await prepareReceipt(page,good);pressed=false;
  await assert.rejects(submitReceipt(page,good,'Saved!',()=>{pressed=true}),/Timeout|waiting/i);
  assert.equal(pressed,true,'the press is known, so it is sent for checking, never retried');
  // A click can save successfully before Playwright reports an error. That must still need checking.
  await prepareReceipt(page,good);pressed=false;
  await assert.rejects(submitReceipt(loseClickResponse(page,'Receive & send to finance'),good,'Receipt received',()=>{pressed=true}),/acknowledgement lost/);
  assert.equal(pressed,true,'an attempted click is treated as uncertain when its response is lost');
  assert.equal(await page.evaluate(()=>window.submitted),1,'the browser actually submitted exactly once');
  console.log(JSON.stringify({result:'PASS',checks:'waits for lists that load late on a new tab; presses the keys of the page\u2019s number pad (invoice, rate, delivery, quantity, cost) and refuses what it cannot type; fills supplier, invoice, dollar rate, delivery and item lines; checks line totals; stops on unknown item, supplier or unit and on an ambiguous unit; never submits on its own; saving re-checks the whole form, presses once and needs the exact success message'}));
}finally{await browser.close()}
