'use strict';
const API='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/transfer-api';
const LOGIN='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/api/login';
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=iso=>iso?new Date(iso).toLocaleString():'';
const number=n=>Number(n??0).toLocaleString(undefined,{maximumFractionDigits:6});
let token=sessionStorage.getItem('ricotta_transfer_session')||'';
let data=null, lines=[{key:crypto.randomUUID(),item_id:'',unit:'',quantity:'',search:''}];
let editId=null, reviewKey=null, poll=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),5000)}
function busy(button,yes){button.disabled=yes;button.dataset.old=button.dataset.old||button.textContent;button.textContent=yes?'Working…':button.dataset.old}
async function request(path,method='GET',payload){
  const res=await fetch(API+'/'+path,{method,headers:{'Content-Type':'application/json','x-session-token':token},body:payload===undefined?undefined:JSON.stringify(payload),cache:'no-store'});
  const body=await res.json().catch(()=>({error:'No server response'}));
  if(!res.ok)throw new Error(body.error||'Request failed');return body;
}
async function refresh(){try{
  data=await request('bootstrap');$('login').hidden=true;$('app').hidden=false;
  $('identity').innerHTML=`<span>${escapeHtml(data.actor==='rozha'?'Rozha':'Yunis')}</span><button id="logout" class="secondary" type="button">Sign out</button>`;
  $('logout').onclick=()=>{sessionStorage.removeItem('ricotta_transfer_session');token='';data=null;clearInterval(poll);$('app').hidden=true;$('login').hidden=false;$('identity').textContent=''};
  fillStorages();renderLines();renderStock();renderHistory();renderItems();
  $('banner').hidden=false;$('banner').textContent='Initial balances came from the September 29 PDF. Recount in both systems after outside stock changes. PC submission is currently disabled during the pilot; approved requests will wait.';
  if(!poll)poll=setInterval(async()=>{if(document.hidden||!token)return;try{await refresh()}catch{}},20000);
}catch(e){if(String(e.message).includes('Sign in')){sessionStorage.removeItem('ricotta_transfer_session');token='';$('login').hidden=false;$('app').hidden=true}throw e}}
function storages(){return data?.storages||[]}
function items(){return data?.items||[]}
function itemById(id){return items().find(x=>x.id===id)}
function unitsFor(id,verifiedOnly=false){return (data?.units||[]).filter(x=>x.item_id===id&&(!verifiedOnly||x.verified&&x.count_per_unit!=null))}
function balance(id,storage){return Number((data?.balances||[]).find(x=>x.item_id===id&&x.storage_name===storage)?.quantity||0)}
function reserved(id,storage){return (data?.lines||[]).filter(l=>l.item_id===id).reduce((n,l)=>{
  const r=(data?.requests||[]).find(x=>x.id===l.request_id);
  return n+(r&&r.from_storage===storage&&['waiting','running','needs_checking'].includes(r.status)?Number(l.quantity)*Number(l.count_per_unit):0)
},0)}
function options(list,selected,blank){return (blank?`<option value="">${escapeHtml(blank)}</option>`:'')+list.map(x=>`<option value="${escapeHtml(x)}" ${x===selected?'selected':''}>${escapeHtml(x)}</option>`).join('')}
function fillStorages(){
  for(const id of ['from','to','stock-storage','count-storage']){const el=$(id),v=el.value;el.innerHTML=options(storages().map(s=>s.name),v,id==='from'||id==='to'?'Choose storage':null)}
  if(!$('stock-storage').value)$('stock-storage').value='Main Storage';
  if(!$('count-storage').value)$('count-storage').value='Main Storage';
}
function eligibleItems(){return items().filter(x=>!x.archived_at&&!x.needs_review&&x.match_verified).sort((a,b)=>a.exact_name.localeCompare(b.exact_name))}
function lineOptions(line){const q=line.search.trim().toLocaleLowerCase();return eligibleItems().filter(x=>!q||x.exact_name.toLocaleLowerCase().includes(q)).slice(0,100)}
function renderLineSelect(line,select){
  const choices=lineOptions(line);select.innerHTML='<option value="">Choose exact item</option>'+choices.map(x=>`<option value="${x.id}" ${line.item_id===x.id?'selected':''}>${escapeHtml(x.exact_name)} · ${escapeHtml(x.counting_unit)}</option>`).join('');
  if(line.item_id&&!choices.some(x=>x.id===line.item_id)){const x=itemById(line.item_id);if(x)select.insertAdjacentHTML('beforeend',`<option value="${x.id}" selected>${escapeHtml(x.exact_name)}</option>`)}
}
function renderLines(){const host=$('lines');host.replaceChildren();for(const line of lines){
  const row=document.createElement('div');row.className='line';row.innerHTML=`<label>Search and choose item<input class="line-search" type="search" placeholder="Type item name" value="${escapeHtml(line.search)}"><select class="line-item" aria-label="Item"></select><small class="available"></small></label><label>Quantity<input class="line-qty" type="number" min="0.000001" step="any" value="${escapeHtml(line.quantity)}"></label><label>Unit<select class="line-unit"></select></label><button class="remove" type="button" aria-label="Remove item">×</button>`;
  const search=row.querySelector('.line-search'),select=row.querySelector('.line-item'),unit=row.querySelector('.line-unit'),qty=row.querySelector('.line-qty');
  function updateUnits(){const list=unitsFor(line.item_id,true);unit.innerHTML=options(list.map(x=>x.unit),line.unit,'Choose unit');if(!list.some(x=>x.unit===line.unit)){line.unit=list.length===1?list[0].unit:'';unit.value=line.unit}updateAvailable()}
  function updateAvailable(){const x=itemById(line.item_id),u=unitsFor(line.item_id,true).find(v=>v.unit===line.unit),storage=$('from').value;
    row.querySelector('.available').textContent=x&&u&&storage?`${number(balance(x.id,storage)/Number(u.count_per_unit))} ${u.unit} in app · ${number(Math.max(0,(balance(x.id,storage)-reserved(x.id,storage))/Number(u.count_per_unit)))} unreserved`:''}
  renderLineSelect(line,select);updateUnits();
  search.oninput=()=>{line.search=search.value;renderLineSelect(line,select)};
  select.onchange=()=>{line.item_id=select.value;line.unit='';updateUnits();invalidateReview()};
  unit.onchange=()=>{line.unit=unit.value;updateAvailable();invalidateReview()};
  qty.oninput=()=>{line.quantity=qty.value;invalidateReview()};
  row.querySelector('.remove').onclick=()=>{lines=lines.filter(x=>x.key!==line.key);if(!lines.length)lines=[{key:crypto.randomUUID(),item_id:'',unit:'',quantity:'',search:''}];renderLines();invalidateReview()};
  host.append(row)
}}
function invalidateReview(){reviewKey=null;$('review-panel').hidden=true}
function review(){
  const from=$('from').value,to=$('to').value;if(!from||!to||from===to)throw new Error('Choose two different storages');
  if(!lines.length||lines.some(l=>!l.item_id||!l.unit||!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0))throw new Error('Choose an item, unit, and positive quantity for every line');
  const keys=new Set(lines.map(l=>l.item_id+'|'+l.unit));if(keys.size!==lines.length)throw new Error('Combine duplicate item and unit lines');
  const sums=new Map();for(const l of lines){const u=unitsFor(l.item_id,true).find(x=>x.unit===l.unit);if(!u)throw new Error('Unit is not verified');
    sums.set(l.item_id,(sums.get(l.item_id)||0)+Number(l.quantity)*Number(u.count_per_unit))}
  for(const [id,q] of sums)if(q>balance(id,from)-reserved(id,from)+1e-8)throw new Error(`Not enough unreserved app stock for ${itemById(id)?.exact_name}`);
  reviewKey=reviewKey||crypto.randomUUID();
  $('review-summary').innerHTML=`<div class="summary"><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong>${$('yesterday').checked?'Workplace will record this for the day before PC submission':'Workplace will record this for the day of PC submission'}</div>`+
    lines.map(l=>`<div class="summary"><strong>${escapeHtml(itemById(l.item_id).exact_name)}</strong>${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</div>`).join('');
  $('review-panel').hidden=false;$('review-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function approve(){const btn=$('approve');busy(btn,true);try{
  const payload={client_key:reviewKey,from_storage:$('from').value,to_storage:$('to').value,record_yesterday:$('yesterday').checked,
    lines:lines.map(l=>({item_id:l.item_id,unit:l.unit,quantity:l.quantity,
      expected_name:itemById(l.item_id)?.exact_name,
      expected_factor:unitsFor(l.item_id,true).find(u=>u.unit===l.unit)?.count_per_unit}))};
  await request('requests','POST',payload);toast('Approved and added to the PC queue');
  lines=[{key:crypto.randomUUID(),item_id:'',unit:'',quantity:'',search:''}];$('from').value='';$('to').value='';$('yesterday').checked=false;invalidateReview();await refresh();showView('history');
}catch(e){if(e.message.includes('Catalog changed')){invalidateReview();await refresh().catch(()=>{})}toast(e.message)}finally{busy(btn,false)}}
function renderStock(){if(!data)return;const storage=$('stock-storage').value||'Main Storage',q=$('stock-search').value.toLocaleLowerCase();
  const filtered=items().filter(x=>!x.archived_at&&(!q||x.exact_name.toLocaleLowerCase().includes(q))).sort((a,b)=>a.exact_name.localeCompare(b.exact_name));
  $('stock-list').innerHTML=filtered.slice(0,200).map(x=>{const b=balance(x.id,storage),low=x.low_stock!=null&&b<=Number(x.low_stock);
    return `<div class="row"><div><strong>${escapeHtml(x.exact_name)}</strong><small>${x.needs_review?'Review needed · ':''}${x.source_ref?escapeHtml(x.source_ref)+' · ':''}${escapeHtml(x.counting_unit)}</small></div><div class="${low?'stock-low':''}">${number(b)}</div></div>`}).join('')||'<p class="muted">No items found.</p>';
  if(filtered.length>200)$('stock-list').insertAdjacentHTML('beforeend',`<p class="hint">Showing first 200 of ${filtered.length}. Search to narrow results.</p>`);
  const old=$('count-item').value;$('count-item').innerHTML=options(items().filter(x=>!x.archived_at).map(x=>x.id),old,'Choose item');
  for(const opt of $('count-item').options){if(opt.value)opt.textContent=itemById(opt.value).exact_name+' · '+itemById(opt.value).counting_unit}
  updateCountUnits();
}
function updateCountUnits(){const v=$('count-unit').value;$('count-unit').innerHTML=options(unitsFor($('count-item').value,true).map(x=>x.unit),v,'Choose unit')}
function renderHistory(){if(!data)return;const requests=data.requests||[];
  $('requests-list').innerHTML=requests.map(r=>{const ls=data.lines.filter(l=>l.request_id===r.id);return `<div class="row"><div><strong>${escapeHtml(r.from_storage)} → ${escapeHtml(r.to_storage)}</strong><small>${ls.map(l=>escapeHtml(l.exact_name)+' · '+number(l.quantity)+' '+escapeHtml(l.unit)).join('<br>')}</small><small>Approved by ${escapeHtml(r.approved_by)} · ${localDate(r.approved_at)}</small><small>${r.recorded_date?'Recorded in workplace for '+escapeHtml(r.recorded_date):r.record_yesterday?'Will record for yesterday when the PC submits':'Will record for submission day'}</small>${r.result_message?`<small>${escapeHtml(r.result_message)}</small>`:''}${r.status==='needs_checking'?`<button type="button" class="secondary resolve-request" data-id="${r.id}">Check result</button>`:''}</div><span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status.replace('_',' '))}</span></div>`}).join('')||'<p class="muted">No transfer requests yet.</p>';
  $('requests-list').querySelectorAll('.resolve-request').forEach(b=>b.onclick=()=>{resolveId=b.dataset.id;$('resolve-status').value='';$('resolve-date').value='';$('resolve-date-label').hidden=true;$('resolve-note').value='';$('resolve-confirm').checked=false;$('resolve-dialog').showModal()});
  $('counts-list').innerHTML=(data.counts||[]).map(c=>`<div class="row"><div><strong>${escapeHtml(itemById(c.item_id)?.exact_name||'Unknown item')}</strong><small>${escapeHtml(c.storage_name)} · ${number(c.quantity)} ${escapeHtml(c.unit)} · ${localDate(c.counted_at)}</small><small>Entered by ${escapeHtml(c.entered_by)} · prior ${number(c.prior_quantity)} ${escapeHtml(itemById(c.item_id)?.counting_unit||'')}</small></div></div>`).join('')||'<p class="muted">No counts entered yet.</p>'}
function renderItems(){if(!data)return;const q=$('item-search').value.toLocaleLowerCase();const all=items().filter(x=>!q||x.exact_name.toLocaleLowerCase().includes(q));
  $('items-list').innerHTML=all.slice(0,200).map(x=>`<div class="row"><div><strong>${escapeHtml(x.exact_name)}</strong><small>${escapeHtml(x.counting_unit)}${x.archived_at?' · Archived':''}${x.needs_review?' · Match needs confirmation':''}${x.source_ref?' · '+escapeHtml(x.source_ref):''}</small></div><button type="button" class="secondary edit-item" data-id="${x.id}">Edit</button></div>`).join('')||'<p class="muted">No items found.</p>';
  if(all.length>200)$('items-list').insertAdjacentHTML('beforeend',`<p class="hint">Showing first 200 of ${all.length}. Search to narrow results.</p>`);
  $('items-list').querySelectorAll('.edit-item').forEach(b=>b.onclick=()=>openItem(b.dataset.id));
}
function unitEditorRow(unit='',factor='',verified=false){const row=document.createElement('div');row.className='unit-row';row.innerHTML=`<label>Unit<input class="unit-name" maxlength="80" value="${escapeHtml(unit)}"></label><label>Counting units per 1<input class="unit-factor" type="number" min="0.00000001" step="any" value="${escapeHtml(factor)}"></label><label class="check"><input class="unit-verified" type="checkbox" ${verified?'checked':''}> Verified</label><button type="button" class="secondary remove-unit">Remove</button>`;row.querySelector('.remove-unit').onclick=()=>row.remove();$('unit-editor').append(row)}
function openItem(id=null){editId=id;const x=id?itemById(id):null;$('item-title').textContent=x?'Edit item':'Add item';$('item-name').value=x?.exact_name||'';$('item-counting').value=x?.counting_unit||'';$('item-counting').disabled=!!x;$('item-usage').value=x?.usage_unit||'';$('item-buying').value=x?.buying_unit||'';$('item-low').value=x?.low_stock??'';$('item-matched').checked=!!x?.match_verified&&!x?.needs_review;$('archive-item').hidden=!x;$('archive-item').textContent=x?.archived_at?'Restore':'Archive';$('unit-editor').replaceChildren();if(x)unitsFor(id).filter(u=>u.unit!==x.counting_unit).forEach(u=>unitEditorRow(u.unit,u.count_per_unit??'',u.verified));$('item-dialog').showModal()}
async function saveItem(e){e.preventDefault();const btn=$('save-item');busy(btn,true);try{
  const payload={exact_name:$('item-name').value.trim(),counting_unit:$('item-counting').value.trim(),usage_unit:$('item-usage').value.trim(),buying_unit:$('item-buying').value.trim(),low_stock:$('item-low').value,
    match_verified:$('item-matched').checked,needs_review:!$('item-matched').checked,
    units:[...$('unit-editor').querySelectorAll('.unit-row')].map(row=>({unit:row.querySelector('.unit-name').value.trim(),count_per_unit:row.querySelector('.unit-factor').value||null,verified:row.querySelector('.unit-verified').checked}))};
  await request(editId?'items/'+editId:'items',editId?'PUT':'POST',payload);$('item-dialog').close();toast('Item saved');await refresh();
}catch(e){toast(e.message)}finally{busy(btn,false)}}
async function archiveItem(){const x=itemById(editId);try{await request('items/'+editId+'/archive','PUT',{archived:!x.archived_at});$('item-dialog').close();toast(x.archived_at?'Item restored':'Item archived');await refresh()}catch(e){toast(e.message)}}
async function saveCount(e){e.preventDefault();const btn=$('count-form').querySelector('button');busy(btn,true);try{
  if(!confirm('Did you record the same count in the workplace system? This changes the app stock ledger only.'))return;
  await request('counts','POST',{item_id:$('count-item').value,storage_name:$('count-storage').value,unit:$('count-unit').value,quantity:$('count-quantity').value,counted_at:new Date($('count-date').value).toISOString(),note:$('count-note').value});
  $('count-quantity').value='';$('count-note').value='';toast('Count recorded in the app');await refresh();
}catch(e){toast(e.message)}finally{busy(btn,false)}}
function showView(name){document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==name+'-view');document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name))}
let resolveId=null;
async function resolveRequest(e){e.preventDefault();const btn=e.target.querySelector('button[type="submit"]');busy(btn,true);try{
  if(!$('resolve-confirm').checked)throw new Error('Confirm that you checked the workplace system');
  await request('resolve','POST',{id:resolveId,status:$('resolve-status').value,note:$('resolve-note').value.trim(),recorded_date:$('resolve-status').value==='completed'?$('resolve-date').value:null});
  $('resolve-dialog').close();toast('Workplace result reconciled');await refresh();
}catch(e){toast(e.message)}finally{busy(btn,false)}}
$('login-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');busy(btn,true);try{const r=await fetch(LOGIN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:$('pin').value})});const b=await r.json();if(!r.ok||!b.token)throw new Error(b.error||'Sign in failed');token=b.token;sessionStorage.setItem('ricotta_transfer_session',token);$('pin').value='';await refresh()}catch(e){toast(e.message)}finally{busy(btn,false)}};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('add-line').onclick=()=>{lines.push({key:crypto.randomUUID(),item_id:'',unit:'',quantity:'',search:''});renderLines();invalidateReview()};
$('from').onchange=()=>{renderLines();invalidateReview()};$('to').onchange=invalidateReview;$('yesterday').onchange=invalidateReview;
$('review').onclick=()=>{try{review()}catch(e){toast(e.message)}};$('approve').onclick=approve;$('cancel-review').onclick=invalidateReview;
$('stock-storage').onchange=renderStock;$('stock-search').oninput=renderStock;$('count-item').onchange=updateCountUnits;$('count-form').onsubmit=saveCount;
$('item-search').oninput=renderItems;$('new-item').onclick=()=>openItem();$('close-item').onclick=()=>$('item-dialog').close();$('add-unit').onclick=()=>unitEditorRow();$('item-form').onsubmit=saveItem;$('archive-item').onclick=archiveItem;
$('close-resolve').onclick=()=>$('resolve-dialog').close();$('resolve-form').onsubmit=resolveRequest;
$('resolve-status').onchange=()=>{const required=$('resolve-status').value==='completed';$('resolve-date-label').hidden=!required;$('resolve-date').required=required};
const now=new Date();$('count-date').value=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(token)refresh().catch(e=>toast(e.message));
