// Runs the PC worker's transfer filler against a local copy of the workplace "Move stock between storages"
// page. Like the real page, it picks a unit by itself once an item is chosen, and spells units its own way
// ("سیت" where the app writes "سێت"). Run: node scripts/transfer-worker-smoke.mjs
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import {inspectTransfer, TRANSFER_PAGE} from '../worker/transfer.mjs';

const BREAD='Big Lebanese Bread - نانی لبنانی گەورە';
const html=`<!doctype html><meta charset="utf-8"><body>
<h1>Move stock between storages</h1><button aria-label="Reset text size">100%</button>
<div>From storage</div><button id="from" aria-label="From storage">Choose</button>
<div>To storage</div><button id="to" aria-label="To storage">Choose</button>
<div class="rounded-xl border p-3" id="row"><button id="item">Choose an ingredient</button></div>
<button id="yday" aria-label="Record for yesterday" aria-pressed="false">Record for yesterday</button>
<button id="move">Move it</button><div id="pop"></div>
<script>
window.moved=0;
const ITEMS={${JSON.stringify(BREAD)}:{units:['دانە','سیت'],have:{'دانە':50,'سیت':5}},'Salt - ملح':{units:['غرام','کیلۆ'],have:{'غرام':1500,'کیلۆ':1.5}}};
const pop=document.getElementById('pop');
function list(choices,onPick,search){
  pop.innerHTML='';let box=null;
  if(search){box=document.createElement('input');box.setAttribute('aria-label','Search items');pop.append(box)}
  const l=document.createElement('div');pop.append(l);
  const paint=()=>{l.innerHTML='';choices.filter(c=>!box||c.includes(box.value)).forEach(c=>{const o=document.createElement('div');o.setAttribute('role','option');o.textContent=c;o.onclick=()=>{pop.innerHTML='';onPick(c)};l.append(o)})};
  if(box){box.oninput=paint;box.focus()}paint();
}
for(const id of ['from','to'])document.getElementById(id).onclick=e=>list(['Main Storage','Minibar','Pizza'],c=>e.target.textContent=c);
document.getElementById('yday').onclick=e=>e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true');
document.getElementById('move').onclick=()=>window.moved++;
document.getElementById('item').onclick=()=>list(Object.keys(ITEMS),pick,true);
function pick(name){
  const it=ITEMS[name],row=document.getElementById('row');let unit=it.units[it.units.length-1];   // picks a unit by itself
  row.innerHTML='<button id="item2"></button><button aria-label="Remove">×</button><input placeholder="amount"><button id="unit"></button><div id="have"></div>';
  document.getElementById('item2').textContent=name;
  const paint=()=>{document.getElementById('unit').textContent=unit;document.getElementById('have').textContent=it.have[unit]+' '+unit+' available in Main Storage'};
  document.getElementById('unit').onclick=()=>list(it.units,u=>{unit=u;paint()});
  paint();row.querySelector('input').focus();
}
</script>`;
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
try{
  const ctx=await browser.newContext({viewport:{width:1280,height:850}});
  await ctx.route(TRANSFER_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
  const page=await ctx.newPage();await page.goto(TRANSFER_PAGE);
  const base={from:'Main Storage',to:'Minibar',yesterday:false,itemName:BREAD};
  const filled=()=>page.evaluate(()=>({from:document.getElementById('from').textContent,to:document.getElementById('to').textContent,
    item:document.getElementById('item2')?.textContent,unit:document.getElementById('unit')?.textContent,amount:document.querySelector('#row input')?.value,moved:window.moved}));
  // 1. The unit the workplace already picked, written "سێت" in the app and "سیت" in the workplace.
  const move=await inspectTransfer(page,{...base,unitLabel:'سێت',quantity:2,appQuantity:5},'Moved!');
  assert.deepEqual(await filled(),{from:'Main Storage',to:'Minibar',item:BREAD,unit:'سیت',amount:'2',moved:0});
  assert.equal(await move.innerText(),'Move it','returns the button without pressing it');
  // 2. Another unit than the one picked by the workplace: it is changed.
  await inspectTransfer(page,{...base,unitLabel:'دانە',quantity:10,appQuantity:50},'Moved!');
  assert.equal((await filled()).unit,'دانە');
  // 3. A recipe unit (gram).
  await inspectTransfer(page,{...base,itemName:'Salt - ملح',unitLabel:'غرام',quantity:250,appQuantity:1500},'Moved!');
  assert.deepEqual([(await filled()).item,(await filled()).unit],['Salt - ملح','غرام']);
  // 4. Stops on a unit the item does not have, and on a stock mismatch. Nothing is ever pressed.
  await assert.rejects(inspectTransfer(page,{...base,unitLabel:'کیلۆ',quantity:1,appQuantity:1},'Moved!'),/no matching unit[\s\S]*دانە \| سیت/);
  await assert.rejects(inspectTransfer(page,{...base,unitLabel:'سێت',quantity:1,appQuantity:4},'Moved!'),/Stock mismatch/);
  assert.equal(await page.evaluate(()=>window.moved),0);
  console.log(JSON.stringify({result:'PASS',checks:'unit already picked by the workplace, changing the unit, Kurdish unit spellings, recipe units, unknown unit and stock mismatch stop it, never presses Move it'}));
}finally{await browser.close()}
