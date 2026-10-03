// Fills the workplace "Move stock between storages" form for one approved transfer and checks every field.
// It returns the "Move it" button without pressing it: the caller presses it only for a final approval.
import { pickNamed, sameUnit } from './match.mjs';
export const TRANSFER_PAGE='https://pos.shaydattendance.com/inventory/transfer';
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
function fail(message){throw new Error(message)}
async function one(locator,label){await locator.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});const count=await locator.count();if(count!==1)throw new Error(`${label}: expected one visible match, found ${count}`);if(!await locator.isVisible())throw new Error(`${label}: hidden`);return locator}
async function pickByText(page,button,choice,label){
  await (await one(button,label+' picker')).click();
  const option=page.getByRole('option',{name:choice,exact:true});
  await (await one(option,label+' option '+choice)).click();
  if((await button.innerText()).trim()!==choice)fail(`${label} did not stay selected`);
}
// An item row shows only "Choose an ingredient" until an item is picked; the amount box appears afterwards.
const itemRows=page=>page.locator('div.rounded-xl.border.p-3').filter({has:page.getByRole('button',{name:/Choose an ingredient/i}).or(page.getByRole('textbox',{name:'amount'}))});
// The unit button of a row: the one button with words that is not the item (the remove button is only "×").
// The workplace picks a unit by itself as soon as an item is chosen, so it may already show one.
async function unitButtonOf(row,itemName){
  const buttons=row.locator('button:visible'), n=await buttons.count(), found=[];
  for(let i=0;i<n;i++){const t=norm(await buttons.nth(i).innerText().catch(()=>''));if(/\p{L}/u.test(t)&&t!==itemName)found.push(i)}
  if(found.length!==1)fail(`unit picker: expected one, found ${found.length}`);
  return buttons.nth(found[0]);
}
// Units are Kurdish in the workplace ("سیت", "ستل"); ours may be spelled a little differently ("سێت", "ستڵ").
async function chooseUnit(page,unitButton,want){
  if(sameUnit(await unitButton.innerText(),want))return;
  await unitButton.click();
  const opts=page.getByRole('option');
  const end=Date.now()+2000;let last=-1;
  for(;;){const n=await opts.count();if((n===last&&n>0)||Date.now()>end)break;last=n;await page.waitForTimeout(80)}
  const n=await opts.count(),hits=[],seen=[];
  for(let i=0;i<n;i++){const t=norm(await opts.nth(i).innerText().catch(()=>''));seen.push(t);if(sameUnit(t,want))hits.push(i)}
  if(hits.length!==1){await page.keyboard.press('Escape');fail(`Unit ${want}: ${hits.length?'more than one':'no'} matching unit for this item (the list shows: ${seen.join(' | ')})`)}
  await opts.nth(hits[0]).click();
  if(!sameUnit(await unitButton.innerText(),want))fail('Selected unit did not match request');
}

// Fills one ingredient row of the workplace form and checks it: the item, its unit, the amount, and the stock the
// workplace shows against the app's own count (which must be equal). Returns what it needs to read the row back later.
async function fillLine(page,row,from,line){
  if(!line||!line.itemName||!line.unitLabel||!(Number.isFinite(line.quantity)&&line.quantity>0))fail('The request is missing its item, unit or quantity');
  const itemButton=row.getByRole('button',{name:/Choose an ingredient/i});
  await (await one(itemButton,'ingredient picker')).click();
  const searches=page.getByRole('textbox',{name:/Search items/i});
  // The workplace's own spelling of the name, used for every check below.
  const itemName=await pickNamed(page,await searches.count()===1?searches:null,line.itemName,'Item');
  await one(row.getByRole('button',{name:itemName,exact:true}),'selected item name');
  const amount=await one(row.getByRole('textbox',{name:'amount'}),'amount');
  const unitButton=await unitButtonOf(row,itemName);
  await chooseUnit(page,unitButton,line.unitLabel);
  await amount.fill(String(line.quantity));
  if(Number(await amount.inputValue())!==Number(line.quantity))fail('Amount did not remain exact');
  // A stock check is intentionally mandatory: the app's own count in the source storage
  // (already in the unit being moved) must equal what the workplace page shows.
  const availableText=(await row.innerText()).split('\n').find(s=>s.includes('available in '+from));
  if(!availableText)fail('Workplace available stock was not visible');
  const match=availableText.trim().match(/^([\d,]+(?:\.\d+)?)\s+(.+?)\s+available in\s+/i);
  if(!match||!sameUnit(match[2],line.unitLabel))fail('Workplace stock unit could not be checked');
  const workplace=Number(match[1].replaceAll(',',''));
  // The page shows a rounded number (19.81), so compare at the precision it displays; a whole number must match exactly.
  const app=Number(line.appQuantity);
  const shown=(match[1].split('.')[1]||'').length;
  const tolerance=shown>0?0.5*Math.pow(10,-shown)+1e-9:1e-6;
  if(!Number.isFinite(workplace)||!Number.isFinite(app)||Math.abs(workplace-app)>tolerance)fail(`Stock mismatch for ${line.itemName}: workplace ${workplace}, app ${Math.round(app*1e6)/1e6} ${line.unitLabel}. Recount it in Stock, and check the unit conversion matches the workplace system.`);
  if(workplace<Number(line.quantity))fail(`Insufficient workplace stock for ${line.itemName}`);
  return {row,itemName,unitButton,amount,line};
}
// Reads a filled row back; used right before the button, so nothing typed or changed in between slips through.
async function checkLine(f){
  const {row,itemName,unitButton,amount,line}=f;
  if(await row.getByRole('button',{name:itemName,exact:true}).count()!==1)fail('Selected item changed before submission');
  if(!sameUnit(await unitButton.innerText(),line.unitLabel))fail('Selected unit changed before submission');
  if(await row.getByRole('textbox',{name:'amount'}).count()!==1||Number(await amount.inputValue())!==Number(line.quantity))fail('Amount changed before submission');
}

export async function inspectTransfer(page,r,success){
  if(page.url()!==TRANSFER_PAGE)fail('Workplace browser is not on the approved transfer page');
  await page.keyboard.press('Control+0'); // browser zoom = 100%
  await one(page.getByRole('heading',{name:/Move stock between storages/i}),'transfer page heading');
  const textSize=await one(page.getByRole('button',{name:'Reset text size'}),'text size');
  if((await textSize.innerText()).replace(/\s/g,'')!=='100%')await textSize.click();
  if((await textSize.innerText()).replace(/\s/g,'')!=='100%')fail('Page text size is not 100%');
  if(!r.from||!r.to||r.from===r.to)fail('Invalid storages');
  // One or more items. An older request carries just the one item at the top.
  const lines=Array.isArray(r.lines)&&r.lines.length?r.lines:[{itemName:r.itemName,unitLabel:r.unitLabel,quantity:r.quantity,appQuantity:r.appQuantity}];
  if(lines.length>30)fail('A transfer can hold 1 to 30 items');
  if(new Set(lines.map(l=>l&&l.itemName)).size!==lines.length)fail('The same item is twice in one transfer');
  for(const l of lines)if(!l||!l.itemName||!l.unitLabel||!(Number.isFinite(l.quantity)&&l.quantity>0))fail('The request is missing its item, unit or quantity');
  // A fresh navigation clears any form left from a prior preview or error.
  await page.goto(TRANSFER_PAGE,{waitUntil:'domcontentloaded'});
  await one(page.getByRole('heading',{name:/Move stock between storages/i}),'transfer page heading');
  await pickByText(page,page.getByRole('button',{name:'From storage',exact:true}),r.from,'source');
  await pickByText(page,page.getByRole('button',{name:'To storage',exact:true}),r.to,'destination');
  const yesterday=await one(page.getByRole('button',{name:/Record for yesterday/i}),'yesterday toggle');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))await yesterday.click();
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))fail('Yesterday setting did not stay selected');
  const rows=itemRows(page);
  if(await rows.count()!==1)fail(`Expected 1 ingredient row; saw ${await rows.count()}`);
  const filled=[];
  for(let i=0;i<lines.length;i++){
    try{
      if(i>0){
        await (await one(page.getByRole('button',{name:/Add another item/i}),'Add another item button')).click();
        const end=Date.now()+4000;
        while(await rows.count()!==i+1&&Date.now()<end)await page.waitForTimeout(60);
        if(await rows.count()!==i+1)fail(`A new ingredient row did not appear (saw ${await rows.count()}, expected ${i+1})`);
      }
      filled.push(await fillLine(page,rows.nth(i),r.from,lines[i]));
    }catch(e){
      if(lines.length>1)e.message=`Item ${i+1} of ${lines.length} (${lines[i].itemName}): ${e.message}`;
      throw e;
    }
  }
  if(await itemRows(page).count()!==lines.length)fail('Unexpected number of form rows');
  // The workplace focuses the amount box as soon as an item is picked. Read every row back once more
  // right before the button, so nothing typed or changed by that focus can slip through.
  for(let i=0;i<filled.length;i++){
    try{await checkLine(filled[i])}catch(e){if(lines.length>1)e.message=`Item ${i+1} of ${lines.length} (${lines[i].itemName}): ${e.message}`;throw e}
  }
  if(page.url()!==TRANSFER_PAGE)fail('Workplace page changed before submission');
  if((await page.getByRole('button',{name:'From storage',exact:true}).innerText()).trim()!==r.from ||
    (await page.getByRole('button',{name:'To storage',exact:true}).innerText()).trim()!==r.to)
    fail('Storage selection changed before submission');
  if((await yesterday.getAttribute('aria-pressed'))!==(r.yesterday?'true':'false'))fail('Yesterday setting changed before submission');
  const move=await one(page.getByRole('button',{name:'Move it',exact:true}),'submit button');
  if(!await move.isEnabled())fail('Submit button is disabled');
  if(success&&await page.getByText(success,{exact:true}).count())fail('Success text was already present before submission');
  return move;
}
