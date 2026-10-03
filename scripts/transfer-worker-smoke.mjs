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
<div id="rows"></div><button id="add">+ Add another item</button>
<button id="yday" aria-label="Record for yesterday" aria-pressed="false">Record for yesterday</button>
<button id="move">Move it</button><div id="pop"></div>
<script>
window.moved=0;
const ITEMS={${JSON.stringify(BREAD)}:{units:['دانە','سیت'],have:{'دانە':50,'سیت':5}},'Salt - ملح':{units:['غرام','کیلۆ'],have:{'غرام':1500,'کیلۆ':1.5}},'Oil - زیت':{units:['لتر','ملی لتر'],have:{'لتر':8,'ملی لتر':8000}}};
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
function newRow(){
  const row=document.createElement('div');row.className='rounded-xl border p-3';row.innerHTML='<button class="choose">Choose an ingredient</button>';
  row.querySelector('.choose').onclick=()=>list(Object.keys(ITEMS),name=>pick(row,name),true);
  document.getElementById('rows').append(row);
}
// Like the real page, another row can only be added once the last one has an item.
document.getElementById('add').onclick=()=>{const last=document.getElementById('rows').lastElementChild;if(last&&last.querySelector('input'))newRow()};
function pick(row,name){
  const it=ITEMS[name];let unit=it.units[it.units.length-1];   // picks a unit by itself
  row.innerHTML='<button class="item2"></button><button aria-label="Remove">×</button><input placeholder="amount"><button class="unit"></button><div class="have"></div>';
  row.querySelector('.item2').textContent=name;
  const paint=()=>{row.querySelector('.unit').textContent=unit;row.querySelector('.have').textContent=it.have[unit]+' '+unit+' available in Main Storage'};
  row.querySelector('.unit').onclick=()=>list(it.units,u=>{unit=u;paint()});
  paint();row.querySelector('input').focus();
}
newRow();
</script>`;
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
try{
  const ctx=await browser.newContext({viewport:{width:1280,height:850}});
  await ctx.route(TRANSFER_PAGE,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
  const page=await ctx.newPage();await page.goto(TRANSFER_PAGE);
  const base={from:'Main Storage',to:'Minibar',yesterday:false,itemName:BREAD};
  const filled=()=>page.evaluate(()=>({from:document.getElementById('from').textContent,to:document.getElementById('to').textContent,
    rows:[...document.querySelectorAll('#rows > div')].map(r=>({item:r.querySelector('.item2')?.textContent,unit:r.querySelector('.unit')?.textContent,amount:r.querySelector('input')?.value})),
    moved:window.moved}));
  const one=async()=>{const f=await filled();return {...f.rows[0],from:f.from,to:f.to,moved:f.moved,count:f.rows.length}};
  // 1. The unit the workplace already picked, written "سێت" in the app and "سیت" in the workplace.
  const move=await inspectTransfer(page,{...base,unitLabel:'سێت',quantity:2,appQuantity:5},'Moved!');
  assert.deepEqual(await one(),{from:'Main Storage',to:'Minibar',item:BREAD,unit:'سیت',amount:'2',moved:0,count:1});
  assert.equal(await move.innerText(),'Move it','returns the button without pressing it');
  // 2. Another unit than the one picked by the workplace: it is changed.
  await inspectTransfer(page,{...base,unitLabel:'دانە',quantity:10,appQuantity:50},'Moved!');
  assert.equal((await one()).unit,'دانە');
  // 3. A recipe unit (gram).
  await inspectTransfer(page,{...base,itemName:'Salt - ملح',unitLabel:'غرام',quantity:250,appQuantity:1500},'Moved!');
  assert.deepEqual([(await one()).item,(await one()).unit],['Salt - ملح','غرام']);
  // 4. Stops on a unit the item does not have, and on a stock mismatch. Nothing is ever pressed.
  await assert.rejects(inspectTransfer(page,{...base,unitLabel:'کیلۆ',quantity:1,appQuantity:1},'Moved!'),/no matching unit[\s\S]*دانە \| سیت/);
  await assert.rejects(inspectTransfer(page,{...base,unitLabel:'سێت',quantity:1,appQuantity:4},'Moved!'),/Stock mismatch/);
  assert.equal(await page.evaluate(()=>window.moved),0);
  // 5. Several items in one transfer: one workplace row per item, "Add another item" pressed between them,
  // each row checked against the app's own stock, and the button still never pressed.
  const salt={itemName:'Salt - ملح',unitLabel:'غرام',quantity:250,appQuantity:1500};
  const bread={itemName:BREAD,unitLabel:'سێت',quantity:2,appQuantity:5};
  const oil={itemName:'Oil - زیت',unitLabel:'لتر',quantity:1.5,appQuantity:8};
  const multi=await inspectTransfer(page,{from:'Main Storage',to:'Minibar',yesterday:true,lines:[bread,salt,oil]},'Moved!');
  assert.deepEqual(await filled(),{from:'Main Storage',to:'Minibar',moved:0,rows:[
    {item:BREAD,unit:'سیت',amount:'2'},{item:'Salt - ملح',unit:'غرام',amount:'250'},{item:'Oil - زیت',unit:'لتر',amount:'1.5'}]});
  assert.equal(await multi.innerText(),'Move it');
  // 6. Any one wrong line stops the whole transfer and says which line it was.
  await assert.rejects(inspectTransfer(page,{from:'Main Storage',to:'Minibar',lines:[bread,{...salt,appQuantity:1400}]},'Moved!'),/Item 2 of 2 \(Salt - ملح\): Stock mismatch/);
  await assert.rejects(inspectTransfer(page,{from:'Main Storage',to:'Minibar',lines:[bread,{...salt,unitLabel:'سندوق'}]},'Moved!'),/Item 2 of 2 \(Salt - ملح\): Unit سندوق/);
  await assert.rejects(inspectTransfer(page,{from:'Main Storage',to:'Minibar',lines:[bread,{...bread}]},'Moved!'),/same item is twice/);
  await assert.rejects(inspectTransfer(page,{from:'Main Storage',to:'Minibar',lines:[bread,{...salt,quantity:0}]},'Moved!'),/missing its item, unit or quantity/);
  await assert.rejects(inspectTransfer(page,{from:'Main Storage',to:'Minibar',lines:[bread,{...salt,quantity:2000}]},'Moved!'),/Item 2 of 2 \(Salt - ملح\): (Stock mismatch|Insufficient)/);
  assert.equal(await page.evaluate(()=>window.moved),0,'nothing was ever pressed');
  console.log(JSON.stringify({result:'PASS',checks:'several items in one transfer (a row each, every one checked, wrong line named, duplicates refused), unit already picked by the workplace, changing the unit, Kurdish unit spellings, recipe units, unknown unit and stock mismatch stop it, never presses Move it'}));
}finally{await browser.close()}
