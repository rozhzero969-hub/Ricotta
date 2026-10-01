// Runs the PC worker's receipt filler against a local copy of the workplace "New purchase receipt"
// page (scripts/fixtures/new-receipt.html) and checks it fills every field, refuses anything unclear,
// and never presses "Receive & send to finance". Run: node scripts/receipt-worker-smoke.mjs
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareReceipt, RECEIPT_PAGE} from '../worker/receipt.mjs';
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
    ['Blueberry Ice Cream - ئایس کریمی بلوبێری','پاکەت (×3000)','5','2000','$ 10,000']],submitted:false});
  // 2. Stops on anything unclear, and never submits.
  const stops=async(r,re,why)=>{await assert.rejects(prepareReceipt(page,{...base,...r}),re,why);assert.equal(await page.evaluate(()=>window.submitted),false)};
  await stops({lines:[{workplaceName:'Tomatoes',unitLabel:'کیلۆ',qty:1,cost:1}]},/no choice matches/,'an item that is not on the list');
  await stops({lines:[{workplaceName:'Odd Item',unitLabel:'دانە',qty:1,cost:1}]},/more than one possible choice/,'a unit with two different sizes');
  await stops({supplierName:'Nobody',lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'کیلۆ',qty:1,cost:1}]},/Supplier: no choice/,'an unknown supplier');
  await stops({lines:[{workplaceName:'Tomato - تەماتە',unitLabel:'سندوق',qty:1,cost:1}]},/Unit "سندوق"/,'a unit the item does not have');
  console.log(JSON.stringify({result:'PASS',checks:'fills supplier, invoice, dollar rate, delivery and item lines; checks line totals; stops on unknown item, supplier or unit and on an ambiguous unit; never submits'}));
}finally{await browser.close()}
