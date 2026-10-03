// Fills the workplace "New purchase receipt" form from a receipt entered in the Ricotta app.
// It ONLY prepares: it never presses "Receive & send to finance". A person checks the filled
// form on the PC and accepts it there. Every field is checked after it is filled; anything
// unclear stops the worker with a message, and the half-filled tab is simply never submitted.
export const RECEIPT_PAGE='https://pos.shaydattendance.com/inventory/new-receipt';
import {readNumber as num,sameNumber} from './numbers.mjs';
import {same,sameUnit as unitIs,searchTerms} from './match.mjs';
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
const up=t=>`translate(normalize-space(text()),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')="${t}"`;
function fail(m){throw new Error(m)}
async function one(locator,label){
  await locator.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
  const n=await locator.count(); if(n!==1)fail(`${label}: expected one match, found ${n}`);
  if(!await locator.isVisible())fail(`${label}: hidden`);
  return locator;
}
// Waits until a list stops changing (same number of entries twice in a row), instead of a fixed pause:
// fast when the page is quick, and still waits when it is slow. Never longer than `max` ms.
async function settle(page,locator,max=2000){
  const end=Date.now()+max;let last=-1;
  for(;;){const n=await locator.count();if(n===last&&n>0)return;last=n;if(Date.now()>end)return;await page.waitForTimeout(60)}
}
// Polls until `test` is true (or `max` ms pass); returns the last result.
async function until(page,test,max=3000){
  const end=Date.now()+max;
  for(;;){const ok=await test();if(ok||Date.now()>end)return ok;await page.waitForTimeout(60)}
}
// The choices a dropdown shows once it is open (role=option first, then plain list entries).
async function openChoices(page){
  const any=page.locator('[role="option"]:visible, [role="listbox"] :is(button,li,div):visible, [cmdk-item]:visible');
  await settle(page,any);
  const opts=page.locator('[role="option"]:visible');
  if(await opts.count())return opts;
  return page.locator('[role="listbox"] :is(button,li,div):visible, [cmdk-item]:visible');
}
// A tab that has only just opened can show "No suppliers found" for a moment, before the workplace page has
// loaded its lists. Those messages are not choices. Waits (up to `max` ms) until the open dropdown shows a
// real choice, closing and reopening it now and then in case it was opened before the data arrived.
const EMPTY=/^(no\b.*\b(found|results?|matches|options|items|suppliers)\b|loading\b|searching\b|please wait)/i;
async function waitForChoices(page,trigger,max=15000){
  const any=page.locator('[role="option"]:visible, [role="listbox"] :is(button,li,div):visible, [cmdk-item]:visible');
  const real=async()=>{
    const n=await any.count();
    for(let i=0;i<n;i++){const s=norm(await any.nth(i).innerText().catch(()=>''));if(s&&!EMPTY.test(s))return true}
    return false;
  };
  const end=Date.now()+max;let reopened=Date.now();
  while(!await real()){
    if(Date.now()>end)return;
    if(Date.now()-reopened>4000){await page.keyboard.press('Escape');await page.waitForTimeout(150);await trigger.click();reopened=Date.now()}
    await page.waitForTimeout(100);
  }
}
// Pick the one choice whose text matches. `match` decides; several identical texts count as one choice.
// With `typed`, the search box is filled with a short part of the name first (see searchTerms).
async function choose(page,trigger,label,match,typed){
  await trigger.click();
  await waitForChoices(page,trigger);
  const box=typed?await page.locator('input:focus').first().elementHandle({timeout:500}).catch(()=>null):null;
  let opts,hits=[],seen=[];
  for(const term of box?searchTerms(typed):[null]){
    if(term!==null){await box.fill(term);await page.waitForTimeout(120)}
    opts=await openChoices(page);hits=[];seen=[];
    const n=await opts.count();
    for(let i=0;i<n;i++){const t=norm(await opts.nth(i).innerText().catch(()=>''));seen.push(t);if(match(t))hits.push({i,t})}
    if(hits.length)break;
  }
  if(!hits.length){await page.keyboard.press('Escape');fail(`${label}: no choice matches${seen.length?` (the list shows: ${seen.slice(0,5).join(' | ')})`:''}`)}
  if(new Set(hits.map(h=>h.t)).size>1){await page.keyboard.press('Escape');fail(`${label}: more than one possible choice (${hits.map(h=>h.t).join(' | ')})`)}
  await opts.nth(hits[0].i).click();
  return hits[0].t;
}
const fieldAfter=(page,labelXpath,what)=>page.locator(`xpath=(//*[${labelXpath}]/following::${what})[1]`);
async function fillChecked(input,value,label){
  await input.fill(String(value));
  const text=await input.inputValue(); if(!sameNumber(text,value))fail(`${label} shows ${text}, expected ${value}`);
}

export async function prepareReceipt(page,r){
  if(!r||!r.supplierName||!r.invoice||!Array.isArray(r.lines)||!r.lines.length)fail('The receipt is missing its supplier, invoice or items');
  if(!['IQD','USD'].includes(r.currency)||(r.currency==='USD'&&!(Number.isFinite(r.rate)&&r.rate>0))||
    (r.delivery!==null&&r.delivery!==undefined&&!(Number.isFinite(r.delivery)&&r.delivery>=0))||
    r.lines.some(l=>!l||!l.workplaceName||!l.unitLabel||!(Number.isFinite(l.qty)&&l.qty>0)||!(Number.isFinite(l.cost)&&l.cost>0)))
    fail('The receipt has an invalid currency, amount or item line');
  await page.goto(RECEIPT_PAGE,{waitUntil:'domcontentloaded'});
  await page.keyboard.press('Control+0');
  await one(page.getByRole('heading',{name:/New purchase receipt/i}),'receipt page heading');
  const rows=page.locator(`xpath=//*[${up('ITEM')}]/ancestor::div[.//*[${up('QTY')}]][1]`);
  if(await rows.count()!==1)fail('The receipt form did not open empty');

  // Supplier (the zone, date, notes and photo are left as they are)
  const sup=await one(fieldAfter(page,'normalize-space(text())="Supplier"','*[self::button or self::select or @role="combobox"]'),'supplier picker');
  if(await sup.evaluate(e=>e.tagName)==='SELECT'){
    const labels=(await sup.evaluate(e=>[...e.options].map(o=>o.text))).filter(t=>same(t)===same(r.supplierName));
    if(new Set(labels).size!==1)fail(labels.length?'Supplier: more than one possible choice':'Supplier: no choice matches');
    await sup.selectOption({label:labels[0]});
  }else await choose(page,sup,'Supplier',t=>same(t)===same(r.supplierName),r.supplierName);
  const supShown=await sup.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(same(supShown)!==same(r.supplierName))fail(`Supplier shows "${norm(supShown)}", expected "${r.supplierName}"`);

  await fillTextChecked(await one(fieldAfter(page,'normalize-space(text())="Invoice number"','input'),'invoice number'),r.invoice);

  if(r.currency==='USD'){
    await (await one(page.getByRole('button',{name:'USD $',exact:true}),'USD button')).click();
    await fillChecked(await one(fieldAfter(page,'starts-with(normalize-space(text()),"Today")','input'),'dollar rate'),r.rate,'Dollar rate');
  }
  if(r.delivery>0){
    await (await one(page.getByRole('button',{name:'No delivery',exact:true}),'delivery button')).click();
    await one(page.getByRole('button',{name:'Delivery: On',exact:true}),'delivery switched on');
    await fillChecked(await one(fieldAfter(page,'normalize-space(text())="How much was the delivery?"','input'),'delivery amount'),r.delivery,'Delivery');
  }

  // Items: search, unit, quantity, cost per unit; the line total is checked against quantity x cost.
  for(let i=0;i<r.lines.length;i++){
    const l=r.lines[i];
    if(i>0){
      await (await one(page.getByRole('button',{name:'Add item',exact:true}),'Add item button')).click();
      if(!await until(page,async()=>await rows.count()===i+1))fail('A new item line did not appear');
    }
    const row=rows.nth(i), buttons=row.locator('button:visible, [role="combobox"]:visible');
    const itemBtn=buttons.nth(0);
    if(!/search item/i.test(norm(await itemBtn.innerText())))fail(`Line ${i+1} is not empty`);
    await choose(page,itemBtn,`Item "${l.workplaceName}"`,t=>same(t)===same(l.workplaceName),l.workplaceName);
    if(same(await itemBtn.innerText())!==same(l.workplaceName))fail(`Line ${i+1} shows "${norm(await itemBtn.innerText())}", expected "${l.workplaceName}"`);
    // Units read like "کیلۆ (×1000)"; ours is the name. Two identical entries are the same unit.
    const unitBtn=buttons.nth(1), u=norm(l.unitLabel);
    const picked=await choose(page,unitBtn,`Unit "${u}" for ${l.workplaceName}`,t=>unitIs(t,u));
    if(norm(await unitBtn.innerText())!==picked)fail(`Line ${i+1}: unit did not stay selected`);
    const inputs=row.locator('input:visible');
    if(await inputs.count()!==2)fail(`Line ${i+1}: expected a quantity and a cost box`);
    await fillChecked(inputs.nth(0),l.qty,`Line ${i+1} quantity`);
    await fillChecked(inputs.nth(1),l.cost,`Line ${i+1} unit cost`);
    const expected=Math.round(l.qty*l.cost*100)/100;
    const showsTotal=async()=>((norm(await row.innerText()).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(num)).some(a=>Math.abs(a-expected)<0.01);
    if(!await until(page,showsTotal,2000))fail(`Line ${i+1}: total does not show ${expected}`);
  }
  // Read everything back once more, then leave it ready: scroll to the totals so the screenshot shows them.
  await checkReceipt(page,r);
  await page.getByRole('button',{name:/Receive & send to finance/i}).scrollIntoViewIfNeeded().catch(()=>{});
}

// Reads the whole form back and compares it with the receipt. Used after filling and again right
// before the final press, so a form changed by anyone in between is never submitted.
export async function checkReceipt(page,r){
  if(page.url()!==RECEIPT_PAGE)fail('The receipt tab is no longer on the receipt page');
  await one(page.getByRole('heading',{name:/New purchase receipt/i}),'receipt page heading');
  const sup=await one(fieldAfter(page,'normalize-space(text())="Supplier"','*[self::button or self::select or @role="combobox"]'),'supplier picker');
  const supShown=await sup.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(same(supShown)!==same(r.supplierName))fail(`Supplier shows "${norm(supShown)}", expected "${r.supplierName}"`);
  const zone=await one(fieldAfter(page,'normalize-space(text())="Zone"','*[self::button or self::select or @role="combobox"]'),'zone picker');
  const zoneShown=await zone.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(norm(zoneShown)!=='Main Storage')fail(`Zone shows "${norm(zoneShown)}", expected "Main Storage"`);
  const inv=await one(fieldAfter(page,'normalize-space(text())="Invoice number"','input'),'invoice number');
  if(norm(await inv.inputValue())!==norm(r.invoice))fail('Invoice number changed');
  const rateBox=fieldAfter(page,'starts-with(normalize-space(text()),"Today")','input');
  if(r.currency==='USD'){
    if(!sameNumber(await (await one(rateBox,'dollar rate')).inputValue(),r.rate))fail('Dollar rate changed');
  }else if(await page.getByText(/^Today.s rate/).count())fail('The receipt is set to dollars, expected IQD');
  if(r.delivery>0){
    await one(page.getByRole('button',{name:'Delivery: On',exact:true}),'delivery switched on');
    const d=await one(fieldAfter(page,'normalize-space(text())="How much was the delivery?"','input'),'delivery amount');
    if(!sameNumber(await d.inputValue(),r.delivery))fail('Delivery amount changed');
  }else await one(page.getByRole('button',{name:'No delivery',exact:true}),'no delivery');
  const rows=page.locator(`xpath=//*[${up('ITEM')}]/ancestor::div[.//*[${up('QTY')}]][1]`);
  if(await rows.count()!==r.lines.length)fail(`The form has ${await rows.count()} item lines, expected ${r.lines.length}`);
  for(let i=0;i<r.lines.length;i++){
    const l=r.lines[i], row=rows.nth(i), buttons=row.locator('button:visible, [role="combobox"]:visible'), u=norm(l.unitLabel);
    if(same(await buttons.nth(0).innerText())!==same(l.workplaceName))fail(`Line ${i+1} item changed`);
    const unitShown=norm(await buttons.nth(1).innerText());
    if(!unitIs(unitShown,u))fail(`Line ${i+1} unit changed`);
    const inputs=row.locator('input:visible');
    if(await inputs.count()!==2)fail(`Line ${i+1}: expected a quantity and a cost box`);
    if(!sameNumber(await inputs.nth(0).inputValue(),l.qty))fail(`Line ${i+1} quantity changed`);
    if(!sameNumber(await inputs.nth(1).inputValue(),l.cost))fail(`Line ${i+1} cost changed`);
    const expected=Math.round(l.qty*l.cost*100)/100;
    const amounts=(norm(await row.innerText()).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(num);
    if(!amounts.some(a=>Math.abs(a-expected)<0.01))fail(`Line ${i+1}: total does not show ${expected}`);
  }
}

// After a final approval on the phone: check everything again, press the button once, and accept
// only the exact success message configured on this PC. Returns normally only on confirmed success.
// Mark the attempt before dispatch: Playwright can throw after the browser already sent the click.
export async function submitReceipt(page,r,successText,onPressed){
  if(!successText)fail('No receipt success message is configured on this PC');
  await checkReceipt(page,r);
  const button=await one(page.getByRole('button',{name:'Receive & send to finance',exact:true}),'Receive & send to finance button');
  if(!await button.isEnabled())fail('Receive & send to finance is disabled');
  if(await page.getByText(successText,{exact:true}).count())fail('The success message was already on the page before pressing');
  onPressed();
  await button.click();
  await page.getByText(successText,{exact:true}).first().waitFor({state:'visible',timeout:15000});
}
async function fillTextChecked(input,value){
  await input.fill(String(value));
  if(norm(await input.inputValue())!==norm(value))fail('Invoice number did not stay as typed');
}
