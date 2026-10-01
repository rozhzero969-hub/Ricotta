// Fills the workplace "New purchase receipt" form from a receipt entered in the Ricotta app.
// It ONLY prepares: it never presses "Receive & send to finance". A person checks the filled
// form on the PC and accepts it there. Every field is checked after it is filled; anything
// unclear stops the worker with a message, and the half-filled tab is simply never submitted.
export const RECEIPT_PAGE='https://pos.shaydattendance.com/inventory/new-receipt';
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
const num=s=>Number(String(s??'').replace(/[^\d.]/g,''));
const up=t=>`translate(normalize-space(text()),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')="${t}"`;
function fail(m){throw new Error(m)}
async function one(locator,label){
  await locator.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
  const n=await locator.count(); if(n!==1)fail(`${label}: expected one match, found ${n}`);
  return locator;
}
// The choices a dropdown shows once it is open (role=option first, then plain list entries).
async function openChoices(page){
  await page.waitForTimeout(250);
  const opts=page.locator('[role="option"]:visible');
  if(await opts.count())return opts;
  return page.locator('[role="listbox"] :is(button,li,div):visible, [cmdk-item]:visible');
}
// Pick the one choice whose text matches. `match` decides; several identical texts count as one choice.
async function choose(page,trigger,label,match,typed){
  await trigger.click();
  if(typed){
    const focused=page.locator('input:focus');
    if(await focused.count()){await focused.fill(typed);await page.waitForTimeout(400)}
  }
  const opts=await openChoices(page), n=await opts.count(), hits=[];
  for(let i=0;i<n;i++){const t=norm(await opts.nth(i).innerText().catch(()=>''));if(match(t))hits.push({i,t})}
  if(!hits.length){await page.keyboard.press('Escape');fail(`${label}: no choice matches`)}
  if(new Set(hits.map(h=>h.t)).size>1){await page.keyboard.press('Escape');fail(`${label}: more than one possible choice (${hits.map(h=>h.t).join(' | ')})`)}
  await opts.nth(hits[0].i).click();
  return hits[0].t;
}
const fieldAfter=(page,labelXpath,what)=>page.locator(`xpath=(//*[${labelXpath}]/following::${what})[1]`);
async function fillChecked(input,value,label){
  await input.fill(String(value));
  const got=num(await input.inputValue()); if(Math.abs(got-Number(value))>1e-6)fail(`${label} shows ${got}, expected ${value}`);
}

export async function prepareReceipt(page,r){
  if(!r||!r.supplierName||!r.invoice||!Array.isArray(r.lines)||!r.lines.length)fail('The receipt is missing its supplier, invoice or items');
  await page.goto(RECEIPT_PAGE,{waitUntil:'domcontentloaded'});
  await page.keyboard.press('Control+0');
  await one(page.getByRole('heading',{name:/New purchase receipt/i}),'receipt page heading');
  const rows=page.locator(`xpath=//*[${up('ITEM')}]/ancestor::div[.//*[${up('QTY')}]][1]`);
  if(await rows.count()!==1)fail('The receipt form did not open empty');

  // Supplier (the zone, date, notes and photo are left as they are)
  const sup=await one(fieldAfter(page,'normalize-space(text())="Supplier"','*[self::button or self::select or @role="combobox"]'),'supplier picker');
  if(await sup.evaluate(e=>e.tagName)==='SELECT')await sup.selectOption({label:r.supplierName});
  else await choose(page,sup,'Supplier',t=>t===norm(r.supplierName),r.supplierName);
  const supShown=await sup.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(norm(supShown)!==norm(r.supplierName))fail(`Supplier shows "${norm(supShown)}", expected "${r.supplierName}"`);

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
      await page.waitForTimeout(300);
      if(await rows.count()!==i+1)fail('A new item line did not appear');
    }
    const row=rows.nth(i), buttons=row.locator('button:visible, [role="combobox"]:visible');
    const itemBtn=buttons.nth(0);
    if(!/search item/i.test(norm(await itemBtn.innerText())))fail(`Line ${i+1} is not empty`);
    await choose(page,itemBtn,`Item "${l.workplaceName}"`,t=>t===norm(l.workplaceName),l.workplaceName);
    if(norm(await itemBtn.innerText())!==norm(l.workplaceName))fail(`Line ${i+1} shows "${norm(await itemBtn.innerText())}", expected "${l.workplaceName}"`);
    // Units read like "کیلۆ (×1000)"; ours is the name. Two identical entries are the same unit.
    const unitBtn=buttons.nth(1), u=norm(l.unitLabel);
    const unitOk=t=>t===u||t.startsWith(u+' (×')||t.startsWith(u+' (x');
    const picked=await choose(page,unitBtn,`Unit "${u}" for ${l.workplaceName}`,unitOk);
    if(norm(await unitBtn.innerText())!==picked)fail(`Line ${i+1}: unit did not stay selected`);
    const inputs=row.locator('input:visible');
    if(await inputs.count()!==2)fail(`Line ${i+1}: expected a quantity and a cost box`);
    await fillChecked(inputs.nth(0),l.qty,`Line ${i+1} quantity`);
    await fillChecked(inputs.nth(1),l.cost,`Line ${i+1} unit cost`);
    await page.waitForTimeout(250);
    const expected=Math.round(l.qty*l.cost*100)/100;
    const amounts=(norm(await row.innerText()).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(num);
    if(!amounts.some(a=>Math.abs(a-expected)<0.01))fail(`Line ${i+1}: total does not show ${expected}`);
  }
  // Read everything back once more, then leave it ready: scroll to the totals so the screenshot shows them.
  await checkReceipt(page,r);
  await page.getByRole('button',{name:/Receive & send to finance/i}).scrollIntoViewIfNeeded().catch(()=>{});
}

// Reads the whole form back and compares it with the receipt. Used after filling and again right
// before the final press, so a form changed by anyone in between is never submitted.
export async function checkReceipt(page,r){
  if(!page.url().startsWith(RECEIPT_PAGE))fail('The receipt tab is no longer on the receipt page');
  await one(page.getByRole('heading',{name:/New purchase receipt/i}),'receipt page heading');
  const sup=await one(fieldAfter(page,'normalize-space(text())="Supplier"','*[self::button or self::select or @role="combobox"]'),'supplier picker');
  const supShown=await sup.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(norm(supShown)!==norm(r.supplierName))fail(`Supplier shows "${norm(supShown)}", expected "${r.supplierName}"`);
  const zone=await one(fieldAfter(page,'normalize-space(text())="Zone"','*[self::button or self::select or @role="combobox"]'),'zone picker');
  const zoneShown=await zone.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:e.innerText);
  if(norm(zoneShown)!=='Main Storage')fail(`Zone shows "${norm(zoneShown)}", expected "Main Storage"`);
  const inv=await one(fieldAfter(page,'normalize-space(text())="Invoice number"','input'),'invoice number');
  if(norm(await inv.inputValue())!==norm(r.invoice))fail('Invoice number changed');
  const rateBox=fieldAfter(page,'starts-with(normalize-space(text()),"Today")','input');
  if(r.currency==='USD'){
    if(Math.abs(num(await (await one(rateBox,'dollar rate')).inputValue())-Number(r.rate))>1e-6)fail('Dollar rate changed');
  }else if(await page.getByText(/^Today.s rate/).count())fail('The receipt is set to dollars, expected IQD');
  if(r.delivery>0){
    await one(page.getByRole('button',{name:'Delivery: On',exact:true}),'delivery switched on');
    const d=await one(fieldAfter(page,'normalize-space(text())="How much was the delivery?"','input'),'delivery amount');
    if(Math.abs(num(await d.inputValue())-Number(r.delivery))>1e-6)fail('Delivery amount changed');
  }else await one(page.getByRole('button',{name:'No delivery',exact:true}),'no delivery');
  const rows=page.locator(`xpath=//*[${up('ITEM')}]/ancestor::div[.//*[${up('QTY')}]][1]`);
  if(await rows.count()!==r.lines.length)fail(`The form has ${await rows.count()} item lines, expected ${r.lines.length}`);
  for(let i=0;i<r.lines.length;i++){
    const l=r.lines[i], row=rows.nth(i), buttons=row.locator('button:visible, [role="combobox"]:visible'), u=norm(l.unitLabel);
    if(norm(await buttons.nth(0).innerText())!==norm(l.workplaceName))fail(`Line ${i+1} item changed`);
    const unitShown=norm(await buttons.nth(1).innerText());
    if(!(unitShown===u||unitShown.startsWith(u+' (×')||unitShown.startsWith(u+' (x')))fail(`Line ${i+1} unit changed`);
    const inputs=row.locator('input:visible');
    if(await inputs.count()!==2)fail(`Line ${i+1}: expected a quantity and a cost box`);
    if(Math.abs(num(await inputs.nth(0).inputValue())-l.qty)>1e-6)fail(`Line ${i+1} quantity changed`);
    if(Math.abs(num(await inputs.nth(1).inputValue())-l.cost)>1e-6)fail(`Line ${i+1} cost changed`);
    const expected=Math.round(l.qty*l.cost*100)/100;
    const amounts=(norm(await row.innerText()).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(num);
    if(!amounts.some(a=>Math.abs(a-expected)<0.01))fail(`Line ${i+1}: total does not show ${expected}`);
  }
}

// After a final approval on the phone: check everything again, press the button once, and accept
// only the exact success message configured on this PC. Returns normally only on confirmed success.
// `onPressed` is called the moment the button has been pressed (after that nothing is retried).
export async function submitReceipt(page,r,successText,onPressed){
  if(!successText)fail('No receipt success message is configured on this PC');
  await checkReceipt(page,r);
  const button=await one(page.getByRole('button',{name:'Receive & send to finance',exact:true}),'Receive & send to finance button');
  if(!await button.isEnabled())fail('Receive & send to finance is disabled');
  if(await page.getByText(successText,{exact:true}).count())fail('The success message was already on the page before pressing');
  await button.click();
  onPressed();
  await page.getByText(successText,{exact:true}).first().waitFor({state:'visible',timeout:15000});
}
async function fillTextChecked(input,value){
  await input.fill(String(value));
  if(norm(await input.inputValue())!==norm(value))fail('Invoice number did not stay as typed');
}
