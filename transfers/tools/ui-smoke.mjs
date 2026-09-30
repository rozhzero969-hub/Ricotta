// Fully mocked phone UI checks. No live Supabase or workplace request is sent.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

let chromium;
try { ({ chromium } = await import('../worker/node_modules/playwright/index.mjs')); }
catch { ({ chromium } = await import('playwright')); }

const itemId='11111111-1111-4111-8111-111111111111';
const fixed={actor:'rozha',storages:[{name:'Main Storage',sort_order:1},{name:'Pizza',sort_order:2}],
  items:[{id:itemId,exact_name:'Sample Flour - ئاردی نموونە',counting_unit:'فەردە',usage_unit:'کیلۆ',buying_unit:null,low_stock:1,match_verified:true,needs_review:false,archived_at:null,source_ref:'sample-001'}],
  units:[{item_id:itemId,unit:'فەردە',count_per_unit:1,verified:true},{item_id:itemId,unit:'کیلۆ',count_per_unit:null,verified:false}],
  balances:[{item_id:itemId,storage_name:'Main Storage',quantity:3}],requests:[],counts:[],lines:[]};
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>console.error('page error:',e.message));
  page.on('console',m=>{if(m.type()==='error')console.error('browser:',m.text())});
  let submitted=null, count=null;
  await page.route(/https:\/\/[^/]+\.supabase\.co\//,async route=>{
    const url=route.request().url();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-session-token','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    const reply=(json,status=200)=>route.fulfill({status,json,headers});
    if(route.request().method()==='OPTIONS')return reply({},204);
    if(url.endsWith('/api/login'))return reply({token:'mock-token',account:'rozha'});
    if(url.endsWith('/transfer-api/bootstrap'))return reply(fixed);
    if(url.endsWith('/transfer-api/requests')){submitted=route.request().postDataJSON();return reply({request:{id:'mock'}},201)}
    if(url.endsWith('/transfer-api/counts')){count=route.request().postDataJSON();return reply({id:'mock-count'},201)}
    return reply({error:'Unexpected request'},404);
  });
  page.on('dialog',d=>d.accept());
  await page.goto(pathToFileURL(path.resolve('transfers/index.html')).href);
  await page.locator('#pin').fill('123456');await page.getByRole('button',{name:'Sign in'}).click();
  await page.getByRole('heading',{name:'New transfer'}).waitFor({timeout:5000}).catch(async e=>{console.error('login state:',await page.locator('#toast').textContent(),await page.locator('#login').isVisible());throw e});
  await page.locator('#from').selectOption('Main Storage');await page.locator('#to').selectOption('Pizza');
  await page.locator('.line-search').fill('sample');
  await page.locator('.line-item').selectOption(itemId);
  await page.locator('.line-qty').fill('1');
  assert.equal(await page.locator('.line-unit').inputValue(),'فەردە');
  assert.equal(await page.locator('.line-unit option').count(),2,'unverified kilo must not be selectable');
  await page.getByRole('button',{name:'Review transfer'}).click();
  const shotDir=process.env.RUNNER_TEMP||'tmp';await mkdir(shotDir,{recursive:true});
  await page.screenshot({path:path.join(shotDir,'transfers-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Approve and queue'}).click();
  await page.waitForFunction(()=>document.querySelector('#history-view')&&!document.querySelector('#history-view').hidden);
  assert.equal(submitted.from_storage,'Main Storage');assert.equal(submitted.to_storage,'Pizza');
  assert.equal(submitted.record_yesterday,false);assert.equal(submitted.lines[0].item_id,itemId);
  assert.equal(submitted.lines[0].expected_name,fixed.items[0].exact_name);
  assert.equal(submitted.lines[0].expected_factor,1);
  await page.getByRole('button',{name:'Stock',exact:true}).click();
  await page.locator('#count-item').selectOption(itemId);await page.locator('#count-unit').selectOption('فەردە');
  await page.locator('#count-quantity').fill('2');await page.getByRole('button',{name:'Record count'}).click();
  await page.waitForFunction(()=>document.querySelector('#count-quantity').value==='');
  assert.equal(count.quantity,'2');assert.equal(count.storage_name,'Main Storage');
  console.log('Phone UI smoke passed at 390px: login, exact item, verified units, approval, app-only count.');
}finally{await browser.close()}
