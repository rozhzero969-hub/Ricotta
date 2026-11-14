const { chromium } = require('playwright');
(async()=>{
  const b = await chromium.launch(); const errors=[];
  const ctx = await b.newContext({viewport:{width:1360,height:860}, colorScheme:'dark'});
  const page = await ctx.newPage(); page.on('pageerror', e=>errors.push(String(e)));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1500);
  await page.keyboard.type('111111'); await page.waitForTimeout(2500);
  await page.evaluate(()=>goView('settings')); await page.waitForTimeout(1500);
  const ids = await page.evaluate(()=>[...document.querySelectorAll('.content input[type=checkbox]')].map((x,i)=>{x.dataset.probe=i; return (x.id||x.dataset.feature||'?')}));
  console.log(ids.join(' '));
  for (const i of [1, 2, 1, 2]) {
    const sel = `[data-probe="${i}"]`;
    await page.evaluate(s=>document.querySelector(s).scrollIntoView({block:'center'}), sel); await page.waitForTimeout(400);
    const before = await page.evaluate(s=>[document.querySelector(s).getBoundingClientRect().top, scrollBox().scrollTop], sel);
    await page.click(sel, {force:true}); const mid=[]; for(let k=0;k<15;k++){ await page.waitForTimeout(100); mid.push(await page.evaluate(s=>{const e=document.querySelector(s); return e?Math.round(e.getBoundingClientRect().top):"x"}, sel)); } console.log("frames", mid.join(",")); const ok = await page.$(".modal-box .btn-primary"); if(ok){ console.log("confirm shown"); await ok.click(); await page.waitForTimeout(1200);} 
    const after = await page.evaluate(s=>{ const e=document.querySelector(s); return e ? [e.getBoundingClientRect().top, scrollBox().scrollTop] : ['gone', scrollBox().scrollTop]; }, sel);
    console.log(ids[i], 'before', before, 'after', after);
  }
  console.log('errors', errors); await b.close();
})();
