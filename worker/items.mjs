// Creates or edits an ingredient in the workplace system (Inventory > Stock), from an item task
// approved in the Ricotta app. Like receipts: it fills the form, reads everything back and stops;
// it presses Save / Add ingredient only after a final approval, once, and only the exact success
// message counts. The recipe unit of an existing ingredient is never changed.
export const STOCK_PAGE='https://pos.shaydattendance.com/inventory/stock';
import {sameNumber} from './numbers.mjs';
const norm=s=>String(s??'').replace(/[‎‏⁦-⁩]/g,'').replace(/\s+/g,' ').trim();
function fail(m){throw new Error(m)}
async function one(locator,label){
  await locator.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
  const n=await locator.count(); if(n!==1)fail(`${label}: expected one match, found ${n}`);
  if(!await locator.isVisible())fail(`${label}: hidden`);
  return locator;
}
const SAME='— same as usage —';
const fieldAfter=(root,label,what)=>root.locator(`xpath=(.//*[normalize-space(text())="${label}"]/following::${what})[1]`);
const picker=(root,label)=>fieldAfter(root,label,'*[self::button or self::select or @role="combobox"]');
async function shown(el){return norm(await el.evaluate(e=>e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:(e.tagName==='INPUT'?e.value:e.innerText)))}
// The open form: the dialog if the page marks one, otherwise the page.
async function form(page,heading){
  await one(page.getByText(heading,{exact:true}),`"${heading}" form`);
  const d=page.getByRole('dialog'); return (await d.count())===1?d:page.locator('body');
}
async function choose(page,trigger,label,want){
  if(await trigger.evaluate(e=>e.tagName)==='SELECT'){await trigger.selectOption({label:want});return}
  await trigger.click();
  const focused=page.locator('input:focus'); if(await focused.count()&&want!==SAME){await focused.fill(want);await page.waitForTimeout(120)}
  // Wait until the list stops changing instead of a fixed pause: fast on a quick page, still safe on a slow one.
  const any=page.locator('[role="option"]:visible, [role="listbox"] :is(button,li,div):visible');
  for(let last=-1,end=Date.now()+2000;;){const n=await any.count();if((n===last&&n>0)||Date.now()>end)break;last=n;await page.waitForTimeout(60)}
  let opts=page.locator('[role="option"]:visible'); if(!await opts.count())opts=page.locator('[role="listbox"] :is(button,li,div):visible');
  const n=await opts.count(), hits=[];
  for(let i=0;i<n;i++)if(norm(await opts.nth(i).innerText().catch(()=>''))===want)hits.push(i);
  if(hits.length!==1){await page.keyboard.press('Escape');fail(`${label}: expected one "${want}" choice, found ${hits.length}`)}
  await opts.nth(hits[0]).click();
}
// "1 کارتۆن = ? دانە" style boxes: which conversions the form asks for, and the box for each.
async function conversions(root){
  const labels=root.locator('xpath=.//*[starts-with(normalize-space(text()),"1") and contains(text(),"=") and contains(text(),"?")]');
  const out=[];
  for(let i=0;i<await labels.count();i++){
    const l=labels.nth(i); if(!await l.isVisible())continue;
    const m=norm(await l.innerText()).match(/^1\s*(.+?)\s*=\s*\?\s*(.+)$/); if(!m)continue;
    out.push({from:norm(m[1]),to:norm(m[2]),input:l.locator('xpath=following::input[1]')});
  }
  return out;
}
function expectedConversions(j){
  const out=[];
  if(j.counting!==j.usage)out.push({from:j.counting,to:j.usage,value:j.countingInUsage});
  if(j.buying!==j.counting)out.push({from:j.buying,to:j.counting,value:j.buyingInCounting});
  return out;
}
const unitShown=(j,u)=>u===j.usage?SAME:u;

async function openForm(page,j){
  await page.goto(STOCK_PAGE,{waitUntil:'domcontentloaded'});
  await page.keyboard.press('Control+0');
  if(j.kind==='create'){
    if(await page.getByText(j.name,{exact:true}).count())fail(`"${j.name}" already exists in the workplace`);
    const add=await one(page.getByRole('button',{name:/^\+?\s*(add (a )?(new )?ingredient|new ingredient)$/i}),'add ingredient button');
    await add.click();
    return form(page,'Add a new ingredient');
  }
  const name=await one(page.getByText(j.fromName,{exact:true}),`ingredient "${j.fromName}" on the stock page`);
  const row=name.locator('xpath=ancestor::*[count(.//button)>=2][1]');
  const buttons=row.locator('button'); if(await buttons.count()<2)fail('Could not find the edit button for this ingredient');
  await buttons.last().click();          // the pen (the eye is just before it)
  const root=await form(page,'Edit ingredient');
  const nameBox=await one(fieldAfter(root,'Ingredient name','input'),'ingredient name');
  if(norm(await nameBox.inputValue())!==norm(j.fromName))fail(`Opened "${norm(await nameBox.inputValue())}", expected "${j.fromName}"`);
  return root;
}

// The recipe unit must be the one the app expects, also when editing (it is never changed there).
async function checkUsage(root,j){
  const usageEl=root.locator('xpath=(.//*[normalize-space(text())="Usage Format (recipe unit)"]/following::*[normalize-space(text())!=""])[1]');
  const usageShown=norm(await (await one(usageEl,'recipe unit')).innerText());
  if(!(usageShown===j.usage||usageShown.startsWith(j.usage+' ')))fail(`Recipe unit shows "${usageShown}", the app expects "${j.usage}"`);
}
export async function prepareItem(page,j){
  if(!j||!['create','edit'].includes(j.kind)||!j.name||!j.usage||!j.buying||!j.counting)fail('The task is missing its name or units');
  if(expectedConversions(j).some(w=>!(Number.isFinite(w.value)&&w.value>0))||
    (j.low!==null&&j.low!==undefined&&!(Number.isFinite(j.low)&&j.low>=0)))fail('The task has an invalid conversion or warning level');
  const root=await openForm(page,j);
  if(j.kind==='edit')await checkUsage(root,j);
  const nameBox=await one(fieldAfter(root,'Ingredient name','input'),'ingredient name');
  await nameBox.fill(j.name);
  if(j.kind==='create')await choose(page,await one(picker(root,'Usage Format (recipe unit)'),'recipe unit picker'),'Recipe unit',j.usage);
  await choose(page,await one(picker(root,'Buying Format'),'buying format picker'),'Buying format',unitShown(j,j.buying));
  await choose(page,await one(picker(root,'Inventory (counting) Format'),'counting format picker'),'Counting format',unitShown(j,j.counting));
  // The conversion boxes appear once the formats are chosen: wait for them (at most 3 s) rather than a fixed pause.
  const want=expectedConversions(j);
  let boxes=await conversions(root);
  const ready=()=>want.every(w=>boxes.some(x=>x.from===w.from&&x.to===w.to));
  for(const end=Date.now()+3000;!ready()&&Date.now()<end;boxes=await conversions(root))await page.waitForTimeout(60);
  for(const w of want){
    const b=boxes.filter(x=>x.from===w.from&&x.to===w.to); if(b.length!==1)fail(`Could not find the "1 ${w.from} = ? ${w.to}" box`);
    await b[0].input.fill(String(w.value));
  }
  const warn=await one(fieldAfter(root,'Warn me when stock drops to','input'),'warning level');
  await warn.fill(j.low===null||j.low===undefined?'':String(j.low));
  await checkItem(page,j);
}

// Reads the whole form back and compares it with the task (after filling, and again right before Save).
export async function checkItem(page,j){
  if(page.url()!==STOCK_PAGE)fail('The ingredient tab is no longer on the stock page');
  const root=await form(page,j.kind==='create'?'Add a new ingredient':'Edit ingredient');
  if(norm(await (await one(fieldAfter(root,'Ingredient name','input'),'ingredient name')).inputValue())!==norm(j.name))fail('Ingredient name changed');
  await checkUsage(root,j);
  if(await shown(await one(picker(root,'Buying Format'),'buying format'))!==unitShown(j,j.buying))fail('Buying format changed');
  if(await shown(await one(picker(root,'Inventory (counting) Format'),'counting format'))!==unitShown(j,j.counting))fail('Counting format changed');
  const want=expectedConversions(j), boxes=await conversions(root);
  if(boxes.length!==want.length)fail(`The form asks for ${boxes.length} conversions, the app expects ${want.length}`);
  for(const w of want){
    const b=boxes.find(x=>x.from===w.from&&x.to===w.to); if(!b)fail(`"1 ${w.from} = ? ${w.to}" is missing`);
    if(!sameNumber(await b.input.inputValue(),w.value))fail(`"1 ${w.from} = ? ${w.to}" shows ${await b.input.inputValue()}, expected ${w.value}`);
  }
  const warn=norm(await (await one(fieldAfter(root,'Warn me when stock drops to','input'),'warning level')).inputValue());
  if(j.low===null||j.low===undefined?warn!=='':!sameNumber(warn,j.low))fail('Warning level changed');
}

export const formOpen=async(page,j)=>(await page.getByText(j.kind==='create'?'Add a new ingredient':'Edit ingredient',{exact:true}).count())===1;

// After the final approval: check again, press the save button once, accept only the exact success message.
export async function submitItem(page,j,successText,onPressed){
  if(!successText)fail('No success message is configured on this PC for this kind of task');
  await checkItem(page,j);
  const label=j.kind==='create'?'Add ingredient':'Save';
  const root=await form(page,j.kind==='create'?'Add a new ingredient':'Edit ingredient');
  const button=await one(root.getByRole('button',{name:label,exact:true}),`${label} button`);
  if(!await button.isEnabled())fail(`${label} is disabled`);
  if(await page.getByText(successText,{exact:true}).count())fail('The success message was already on the page before pressing');
  // A rejected click may already have reached the browser; always send that case for checking.
  onPressed();
  await button.click();
  await page.getByText(successText,{exact:true}).first().waitFor({state:'visible',timeout:15000});
}
