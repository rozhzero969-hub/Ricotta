// Runs the PC worker's ingredient create/edit filler against a local copy of the workplace stock page
// (scripts/fixtures/stock-page.html): fills and checks every field, refuses anything unclear, and
// presses Save / Add ingredient only when asked, once, with the exact success message.
// Run: node scripts/items-worker-smoke.mjs
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareItem, submitItem, STOCK_PAGE} from '../worker/items.mjs';
import {loseClickResponse} from './worker-test-helpers.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const html=readFileSync(path.join(here,'fixtures/stock-page.html'),'utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route(STOCK_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
const page=await ctx.newPage();
const saved=()=>page.evaluate(()=>[window.saved,window.lastSave]);
try{
  // 1. Create: buying in cartons of 24 pieces, counted and used in pieces.
  const cola={kind:'create',name:'Cola - کۆلا',usage:'دانە',buying:'کارتۆن',counting:'دانە',countingInUsage:null,buyingInCounting:24,low:10};
  await prepareItem(page,cola);
  assert.deepEqual(await saved(),[0,null],'nothing saved while preparing');
  await submitItem(page,cola,'Ingredient added',()=>{});
  const [n,s]=await saved();
  assert.equal(n,1);assert.deepEqual({name:s.name,usage:s.usage,buying:s.buying,counting:s.counting,conv:s.conv,low:s.low},
    {name:'Cola - کۆلا',usage:'دانە',buying:'کارتۆن',counting:'دانە',conv:{'کارتۆن>دانە':'24'},low:'10'});
  // 2. An ingredient that already exists is never created twice.
  await assert.rejects(prepareItem(page,{...cola,name:'Tomato - تەماتە'}),/already exists/);
  // 3. Edit: change how many kilos are in a carton and the warning level; the recipe unit stays.
  const tomato={kind:'edit',fromName:'Tomato - تەماتە',name:'Tomato - تەماتە',usage:'غرام',buying:'کارتۆن',counting:'کیلۆ',countingInUsage:1000,buyingInCounting:12,low:6};
  await prepareItem(page,tomato);
  await submitItem(page,tomato,'Changes saved',()=>{});
  const [n2,s2]=await saved();
  assert.equal(n2,1,'pressed once (each task starts from a fresh page)');assert.deepEqual({conv:s2.conv,low:s2.low,usage:s2.usage},{conv:{'کیلۆ>غرام':'1000','کارتۆن>کیلۆ':'12'},low:'6',usage:'غرام'});
  // 4. Stops on anything unclear, and never presses.
  await assert.rejects(prepareItem(page,{...tomato,usage:'کیلۆ'}),/Recipe unit shows/,'the app expects a different recipe unit');
  await assert.rejects(prepareItem(page,{...tomato,fromName:'Tomatoes'}),/expected one match, found 0/,'an ingredient that is not on the page');
  await assert.rejects(prepareItem(page,{...cola,name:'Odd',buying:'سندوق'}),/expected one "سندوق" choice/,'a unit the workplace does not have');
  // 5. A form changed after filling is not saved; no success message configured means no press.
  await prepareItem(page,tomato);
  await page.locator('[data-k="کارتۆن>کیلۆ"]').fill('11');
  let pressed=false;
  await assert.rejects(submitItem(page,tomato,'Changes saved',()=>{pressed=true}),/shows 11, expected 12/);
  assert.equal(pressed,false);
  for(const changed of ['-12','12oops','1,2','']){
    await prepareItem(page,tomato);pressed=false;
    await page.locator('[data-k="کارتۆن>کیلۆ"]').fill(changed);
    await assert.rejects(submitItem(page,tomato,'Changes saved',()=>{pressed=true}),/expected 12/);
    assert.equal(pressed,false);assert.equal((await saved())[0],0);
  }
  await prepareItem(page,tomato);
  await assert.rejects(submitItem(page,tomato,'',()=>{pressed=true}),/No success message/);
  assert.equal(pressed,false);assert.equal((await saved())[0],0,'nothing saved');
  await prepareItem(page,tomato);pressed=false;
  await assert.rejects(submitItem(loseClickResponse(page,'Save'),tomato,'Changes saved',()=>{pressed=true}),/acknowledgement lost/);
  assert.equal(pressed,true,'a click error after dispatch goes for checking');
  assert.equal((await saved())[0],1,'one save reached the browser');
  console.log(JSON.stringify({result:'PASS',checks:'create and edit fill and check every field (name, recipe unit, buying and counting formats, conversions, warning level); never creates a duplicate; stops on an unexpected recipe unit, a missing ingredient or unit; presses once only with the exact success message; a changed form is never saved'}));
}finally{await browser.close()}
