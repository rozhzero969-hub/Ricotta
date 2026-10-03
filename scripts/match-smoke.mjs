// Checks how the PC finds a name in the workplace lists: look-alike Kurdish/Arabic letters, a search box that
// finds nothing for the whole two-language name, and refusing two matches. Run: node scripts/match-smoke.mjs
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import {same,sameUnit,searchTerms,pickNamed} from '../worker/match.mjs';

const app='Golden Bread Bakery / صمون گۆلدن برید', work='Golden Bread Bakery / صمون گۆلدن بريد';   // ی vs ي
assert.notEqual(app,work);
assert.equal(same(app),same(work));
assert.equal(same(' golden  bread bakery/صمون گۆلدن برید‏'),same(app));
assert.notEqual(same('Golden Bread'),same(app));
assert.equal(same('تةمـاتة'),same('تەماتە'),'Kurdish written with Arabic letters');
assert.equal(same('كيلو'),same('کیلۆ'));assert.equal(same('سیت'),same('سێت'));assert.equal(same('ستل'),same('ستڵ'));
assert.equal(same('٢٥٠ غرام'),same('250 غرام'),'Arabic digits');
assert.notEqual(same('دانە'),same('دەستە'));
assert.ok(sameUnit('ملی لتر','ملی‌لتر')&&sameUnit('کیلۆ (×1000)','كيلو')&&!sameUnit('لتر','ملی لتر'),'units');
assert.deepEqual(searchTerms(app),['Golden Bread Bakery','Golden','']);
assert.deepEqual(searchTerms('Tomato - تەماتە'),['Tomato','']);

const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
try{
  const page=await browser.newPage();
  // A list whose search box matches words of the whole text, so typing the app's spelling finds nothing.
  await page.setContent(`<input aria-label="Search items"><div id="l"></div><div id="picked"></div><script>
    const items=${JSON.stringify(['نانی كوردي',work+'\n12 piece available','Golden Cheese','Twin\nTwin x','Twin'])};
    const box=document.querySelector('input'),l=document.getElementById('l');
    const paint=()=>{l.innerHTML='';items.filter(x=>x.includes(box.value)).forEach(x=>{const o=document.createElement('div');o.setAttribute('role','option');o.innerText=x;o.onclick=()=>document.getElementById('picked').textContent=x.split('\\n')[0];l.append(o)})};
    box.oninput=paint;paint();</script>`);
  const search=page.getByRole('textbox',{name:'Search items'});
  assert.equal(await pickNamed(page,search,app,'Item'),work,'returns the workplace spelling');
  assert.equal(await page.locator('#picked').textContent(),work);
  // A Kurdish-only name typed with Arabic look-alike letters in the workplace: found through the full list.
  assert.equal(await pickNamed(page,search,'نانی کوردی','Supplier'),'نانی كوردي');
  await assert.rejects(pickNamed(page,search,'Twin','Item'),/ambiguous/);
  await assert.rejects(pickNamed(page,search,'Nobody Here','Item'),/not on the workplace page/);
  console.log(JSON.stringify({result:'PASS',checks:'look-alike letters, two-language names, short search terms, one match only'}));
}finally{await browser.close()}
