/* Restaurant cash expenses. Orders and workplace receipts never create entries
   here automatically: recording the same payment twice would overstate costs.
   Both signed-in accounts have the same access. Requires app/storage/modals at
   call time only; load before app.js. IQD uses dinars, USD uses integer cents. */
const FIN_CATEGORIES = ['food','supplies','rent','utilities','staff','transport','other'];
const FIN_PAYMENTS = ['cash','card','bank','other'];
const financeState = {rows:[],totals:null,total:0,hasMore:false,loaded:false,loading:false,error:'',filters:null,epoch:0,request:0,nextOffset:0,ledgerVersion:null,pendingErrors:new Map(),recovering:new Set()};

function financeToday(){
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function financeDefaultFilters(){
  const today = financeToday(), [year,month] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year,month,0)).getUTCDate();
  return {from:today.slice(0,8)+'01',to:today.slice(0,8)+String(last).padStart(2,'0'),category:'',currency:'',status:'active'};
}
function resetFinanceState(){
  Object.assign(financeState,{rows:[],totals:null,total:0,hasMore:false,loaded:false,loading:false,error:'',filters:null,epoch:financeState.epoch+1,request:financeState.request+1,nextOffset:0,ledgerVersion:null,pendingErrors:new Map(),recovering:new Set()});
}
function financeSessionValid(epoch,session){
  return financeState.epoch === epoch && !!state.account && apiSessionMatches(session) && apiAccountMatchesUi(session);
}
function financeLabel(prefix,value){ return t(prefix + value[0].toUpperCase() + value.slice(1)); }
function financeOptions(values,prefix,selected,all=''){
  return (all ? `<option value="">${esc(all)}</option>` : '') + values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(financeLabel(prefix,v))}</option>`).join('');
}
/* Formatting uses BigInt so a long ledger's total never loses a dinar/cent. */
function financeAmount(minor,currency){
  let n; try{ n=BigInt(String(minor ?? 0)); }catch{ return '—'; }
  const negative=n<0n; if(negative) n=-n;
  const unit=currency==='USD'?100n:1n;
  const whole=(n/unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return `${negative?'-':''}${whole}${unit===100n?'.'+(n%100n).toString().padStart(2,'0'):''} ${currency}`;
}
function financeInputAmount(row){
  if(!row) return '';
  const value=BigInt(String(row.amountMinor));
  return row.currency==='USD' ? `${value/100n}.${(value%100n).toString().padStart(2,'0')}` : value.toString();
}
function financeParseAmount(raw,currency){
  const value=String(raw).trim();
  if(!(currency==='IQD' ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) return null;
  const [whole,decimals='']=value.split('.');
  const minor=BigInt(whole)*(currency==='USD'?100n:1n)+(currency==='USD'?BigInt(decimals.padEnd(2,'0')):0n);
  return minor>0n && minor<=1000000000000n ? Number(minor) : null;
}
function financeQuery(offset=0){
  const params=new URLSearchParams({...financeState.filters,limit:'50',offset:String(offset)});
  for(const [key,value] of [...params]) if(value==='') params.delete(key);
  return 'finance?'+params.toString();
}
/* Separate keys avoid losing one tab's operation when another tab saves. No
   request leaves the device until its stable payload has been persisted. */
function financePendingEntries(){
  if(!state.account) return [];
  const prefix=LS_PREFIX+'financePending:'+state.account+':',entries=[];
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key?.startsWith(prefix)) continue;
      try{
        const entry=JSON.parse(localStorage.getItem(key));
        if(entry?.account===state.account && entry.body?.operationId && ['POST','PUT'].includes(entry.method) && /^finance(?:\/[a-f0-9-]{36}(?:\/void)?)?$/.test(entry.path)) entries.push(entry);
      }catch{ /* A damaged entry cannot become a server request. */ }
    }
  }catch{ /* A damaged local entry cannot become a server request. */ }
  return entries;
}
function financeHasPending(){return financePendingEntries().length>0;}
function financeFiltersValid(){return !(financeState.filters?.from && financeState.filters?.to && financeState.filters.from>financeState.filters.to);}
function financePersistOperation(path,method,body,account){
  const entry={path,method,body,account,at:new Date().toISOString()};
  return lset('financePending:'+account+':'+body.operationId,entry);
}
function financeClearOperation(body,account){
  lset('financePending:'+account+':'+body.operationId,null);
  financeState.pendingErrors.delete(body.operationId);
}
async function financeWrite(path,method,body,epoch,session){
  if(!financeSessionValid(epoch,session)) return staleApiReply();
  if(!financePersistOperation(path,method,body,session.account)) return {ok:false,status:0,localFailure:true};
  financePaint();
  const reply=await api(path,{method,body});
  if(!financeSessionValid(epoch,session) || reply.stale) return staleApiReply();
  if(reply.ok || [400,404,409].includes(reply.status)) financeClearOperation(body,session.account);
  financePaint();return reply;
}
function financePendingHtml(){
  const entries=financePendingEntries();
  if(!entries.length) return '';
  return `<aside class="fin-pending glass" aria-label="${esc(t('finUnconfirmed'))}"><h2>${esc(t('finUnconfirmed'))}</h2><p>${esc(t('finRecoveryHint'))}</p>${entries.map(entry=>`<div class="fin-pending-row"><div><bdi>${esc(entry.body.description || t('finVoid'))}</bdi>${entry.body.amountMinor?` · <bdi>${esc(financeAmount(entry.body.amountMinor,entry.body.currency))}</bdi>`:''}<small role="status">${esc(financeState.pendingErrors.get(entry.body.operationId) || '')}</small></div><button class="btn btn-primary" data-finrecover="${esc(entry.body.operationId)}"${financeState.recovering.has(entry.body.operationId)?' disabled aria-busy="true"':''}>${esc(t('finRecover'))}</button></div>`).join('')}</aside>`;
}
async function financeRecover(operationId){
  const entry=financePendingEntries().find(e=>e.body.operationId===operationId);
  if(!entry || financeState.recovering.has(operationId)) return;
  const epoch=financeState.epoch,session=apiSession();if(!financeSessionValid(epoch,session)) return;
  financeState.recovering.add(operationId);financePaint();
  const reply=await financeWrite(entry.path,entry.method,entry.body,epoch,session);
  if(!financeSessionValid(epoch,session) || reply.stale) return;
  financeState.recovering.delete(operationId);
  if(reply.ok){toast(t('finRecovered'));financeLoad();}
  else {financeState.pendingErrors.set(operationId,financeError(reply));financePaint();if(!financePendingEntries().some(e=>e.body.operationId===operationId)) showAlert(esc(financeError(reply)));}
}
function financeSummaryHtml(){
  return `<div class="fin-summaries">${['IQD','USD'].map(currency=>{
    const total=financeState.totals?.[currency];
    return `<div class="fin-summary glass"><span>${esc(t('finPaidTotal'))} · ${currency}</span><strong dir="ltr">${financeState.loaded?esc(financeAmount(total?.amountMinor || '0',currency)):'—'}</strong><small>${esc(t('finEntryCount')(total?.count || 0))}</small></div>`;
  }).join('')}</div><p class="fin-note">${esc(t('finTotalsHint'))}</p>`;
}
function financeRowHtml(row){
  const voided=row.status==='void';
  return `<article class="fin-entry glass${voided?' fin-void':''}" data-finid="${esc(row.id)}">
    <div class="fin-entry-top"><div><h2 dir="auto">${esc(row.description)}</h2><div class="fin-meta">${esc(row.date)} · ${esc(financeLabel('finCat',row.category))}</div></div><strong class="fin-amount" dir="ltr">${esc(financeAmount(row.amountMinor,row.currency))}</strong></div>
    <div class="fin-meta">${esc(financeLabel('finPay',row.paymentMethod))}${row.supplierName?' · <bdi>'+esc(row.supplierName)+'</bdi>':''} · ${esc(t('finRecordedBy'))} ${esc(accountLabel(row.createdBy))}</div>
    ${row.notes?`<p class="fin-entry-notes" dir="auto">${esc(row.notes)}</p>`:''}
    ${voided?`<p class="fin-void-reason"><b>${esc(t('finVoided'))}</b> · <bdi>${esc(row.voidReason || '')}</bdi></p>`:''}<div class="fin-entry-actions"><button class="btn btn-ghost" data-finchanges="${esc(row.id)}">${esc(t('finChanges'))}</button>${voided?'':`<button class="btn btn-ghost" data-finedit="${esc(row.id)}">${esc(t('finEdit'))}</button><button class="btn btn-ghost danger" data-finvoid="${esc(row.id)}">${esc(t('finVoid'))}</button>`}</div>
  </article>`;
}
function financeResultsHtml(){
  if(financeState.loading && !financeState.loaded) return `<div class="empty" role="status">${esc(t('loading'))}</div>`;
  if(financeState.error && !financeState.loaded) return `<div class="empty" role="alert">${esc(financeState.error)}<button class="btn btn-primary" data-finrefresh>${esc(t('retry'))}</button></div>`;
  const rows=financeState.rows.map(financeRowHtml).join('') || emptyState(esc(t('finEmpty')));
  return `${financeState.error?`<p class="fin-error" role="alert">${esc(financeState.error)}</p>`:''}<p class="fin-list-count" role="status">${esc(t('finShowing')(financeState.rows.length,financeState.total))}</p>${rows}${financeState.hasMore?`<button class="btn btn-ghost fin-more" data-finmore${financeState.loading?' disabled aria-busy="true"':''}>${esc(financeState.loading?t('loading'):t('finMore'))}</button>`:''}`;
}
function renderFinance(){
  financeState.filters ||= financeDefaultFilters();
  const f=financeState.filters;
  return `<section id="financeScreen"><div class="page-heading"><div><div class="page-kicker">${esc(t('finKicker'))}</div><h1>${esc(t('expenses'))}</h1></div><button class="btn btn-primary" id="finAdd">+ ${esc(t('finAdd'))}</button></div>
    <p class="fin-intro">${esc(t('finIntro'))}</p><div id="finPending">${financePendingHtml()}</div><div id="finSummary">${financeSummaryHtml()}</div>
    <div class="fin-filters glass" role="group" aria-label="${esc(t('finFilters'))}">
      <div class="field"><label for="finFrom">${esc(t('finFrom'))}</label><input id="finFrom" type="date" value="${esc(f.from)}"></div><div class="field"><label for="finTo">${esc(t('finTo'))}</label><input id="finTo" type="date" value="${esc(f.to)}"></div>
      <div class="field"><label for="finCategoryFilter">${esc(t('finCategory'))}</label><select id="finCategoryFilter">${financeOptions(FIN_CATEGORIES,'finCat',f.category,t('finAllCategories'))}</select></div>
      <div class="field"><label for="finCurrencyFilter">${esc(t('finCurrency'))}</label><select id="finCurrencyFilter"><option value="">${esc(t('finBothCurrencies'))}</option>${['IQD','USD'].map(c=>`<option${f.currency===c?' selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="finStatusFilter">${esc(t('finStatus'))}</label><select id="finStatusFilter">${['active','all','void'].map(s=>`<option value="${s}"${f.status===s?' selected':''}>${esc(financeLabel('finStatus',s))}</option>`).join('')}</select></div>
    </div><div class="fin-tools"><button class="btn btn-ghost" id="finRefresh">${esc(t('refresh'))}</button><button class="btn btn-ghost" id="finExport">${esc(t('finExport'))}</button></div>
    <div id="finResults" aria-busy="${financeState.loading}">${financeResultsHtml()}</div></section>`;
}
function financePaint(){
  if(state.view!=='expenses') return;
  const summary=document.getElementById('finSummary'),results=document.getElementById('finResults'),pending=document.getElementById('finPending');
  if(pending) pending.innerHTML=financePendingHtml();
  if(summary) summary.innerHTML=financeSummaryHtml();
  if(results){results.setAttribute('aria-busy',String(financeState.loading));results.innerHTML=financeResultsHtml();}
}
async function financeLoad(more=false){
  const epoch=financeState.epoch,session=apiSession(),request=++financeState.request;
  if(!financeSessionValid(epoch,session)) return false;
  if(!financeFiltersValid()){financeState.error=t('finDateRange');financePaint();return false;}
  const offset=more?financeState.nextOffset:0;
  financeState.loading=true;financeState.error='';financePaint();
  const reply=await api(financeQuery(offset));
  if(!financeSessionValid(epoch,session) || request!==financeState.request || reply.stale) return false;
  financeState.loading=false;
  if(!reply.ok || !Array.isArray(reply.data?.expenses)){
    financeState.error=t('loadFailed');financePaint();return false;
  }
  if(more && reply.data.ledgerVersion!==financeState.ledgerVersion){toast(t('finListChanged'));return financeLoad();}
  financeState.ledgerVersion=reply.data.ledgerVersion;
  financeState.rows=more ? [...financeState.rows,...reply.data.expenses.filter(e=>!financeState.rows.some(old=>old.id===e.id))] : reply.data.expenses;
  financeState.nextOffset=offset+reply.data.expenses.length;
  financeState.totals=reply.data.totals;financeState.total=reply.data.total;financeState.hasMore=!!reply.data.hasMore;financeState.loaded=true;
  financePaint();return true;
}
function wireFinance(){
  const root=document.getElementById('financeScreen');if(!root) return;
  root.onclick=event=>{
    const button=event.target.closest('button');if(!button || !root.contains(button)) return;
    if(button.id==='finAdd'){
      if(financePendingEntries().some(e=>e.path==='finance')) showAlert(esc(t('finRecoveryHint')));
      else financeOpenForm();
    }
    else if(button.id==='finRefresh' || button.hasAttribute('data-finrefresh')) withBusy(button,()=>financeLoad());
    else if(button.hasAttribute('data-finmore')) withBusy(button,()=>financeLoad(true));
    else if(button.id==='finExport') withBusy(button,()=>financeExport());
    else if(button.dataset.finedit) financeOpenForm(financeState.rows.find(row=>row.id===button.dataset.finedit));
    else if(button.dataset.finvoid) financeVoidForm(financeState.rows.find(row=>row.id===button.dataset.finvoid));
    else if(button.dataset.finrecover) financeRecover(button.dataset.finrecover);
    else if(button.dataset.finchanges) withBusy(button,()=>financeChanges(financeState.rows.find(row=>row.id===button.dataset.finchanges)));
  };
  root.onchange=event=>{
    const ids={finFrom:'from',finTo:'to',finCategoryFilter:'category',finCurrencyFilter:'currency',finStatusFilter:'status'};
    const key=ids[event.target.id];if(!key) return;
    financeState.request++;
    financeState.filters[key]=event.target.value;
    financeState.loaded=false;financeState.rows=[];financeState.totals=null;financeState.total=0;financeState.loading=false;
    if(financeState.filters.from && financeState.filters.to && financeState.filters.from>financeState.filters.to){
      financeState.error=t('finDateRange');financePaint();return;
    }
    financeLoad();
  };
  financeLoad();
}
function financeError(reply){
  if(reply.localFailure) return t('finStorageFull');
  if(reply.status===409) return t('finConflict');
  if(reply.status===400) return t('finInvalid');
  return t('finRetrySame');
}
/* After an uncertain response, lock exactly the submitted operation. Retry
   repeats its UUID and payload; changing it could hide a saved first attempt. */
function financeLockDraft(box){
  setTimeout(()=>{
    if(!box.isConnected) return;
    box.querySelectorAll('.modal-body input,.modal-body select,.modal-body textarea').forEach(control=>{control.disabled=true;});
  },0);
}
function financeField(id,label,input){return `<div class="field"><label for="${id}">${esc(t(label))}</label>${input}</div>`;}
function financeOpenForm(row){
  if(row?.status==='void') return;
  const epoch=financeState.epoch,session=apiSession();if(!financeSessionValid(epoch,session)) return;
  if(row && financePendingEntries().some(entry=>entry.path.startsWith('finance/'+row.id))){showAlert(esc(t('finRecoveryHint')));return;}
  const id=row?.id || crypto.randomUUID(),operationId=crypto.randomUUID();let box,pending=null;
  const currency=row?.currency || 'IQD';
  showFormModal({title:esc(t(row?'finEdit':'finAdd')),okLabel:t('save'),banner:esc(t('finFormHint')),bodyHtml:`
    ${financeField('finDescription','finDescription',`<input id="finDescription" type="text" maxlength="160" value="${esc(row?.description || '')}" dir="auto">`)}
    <div class="fin-form-grid">${financeField('finDate','finDate',`<input id="finDate" type="date" value="${esc(row?.date || financeToday())}">`)}${financeField('finCategory','finCategory',`<select id="finCategory">${financeOptions(FIN_CATEGORIES,'finCat',row?.category || 'food')}</select>`)}
    ${financeField('finCurrency','finCurrency',`<select id="finCurrency"><option${currency==='IQD'?' selected':''}>IQD</option><option${currency==='USD'?' selected':''}>USD</option></select>`)}${financeField('finAmount','finAmount',`<input id="finAmount" inputmode="decimal" type="text" value="${esc(financeInputAmount(row))}" dir="ltr" autocomplete="off" aria-describedby="finAmountHint"><small id="finAmountHint">${esc(t(currency==='IQD'?'finIqdHint':'finUsdHint'))}</small>`)}
    ${financeField('finPayment','finPayment',`<select id="finPayment">${financeOptions(FIN_PAYMENTS,'finPay',row?.paymentMethod || 'cash')}</select>`)}${financeField('finSupplier','finSupplier',`<input id="finSupplier" type="text" dir="auto" maxlength="160" list="finSuppliers" value="${esc(row?.supplierName || '')}"><datalist id="finSuppliers">${state.suppliers.map(s=>`<option value="${esc(s.name)}"></option>`).join('')}</datalist>`)}</div>
    ${financeField('finNotes','finNotes',`<textarea id="finNotes" rows="3" maxlength="1000" dir="auto">${esc(row?.notes || '')}</textarea>`)}`,
    onOpen:el=>{box=el;box.querySelector('#finCurrency').onchange=()=>{box.querySelector('#finAmountHint').textContent=t(box.querySelector('#finCurrency').value==='IQD'?'finIqdHint':'finUsdHint');};},
    onSubmit:async()=>{
      if(!financeSessionValid(epoch,session)) return {error:t('sessionEnded')};
      if(!pending){
        const description=box.querySelector('#finDescription').value.trim(),date=box.querySelector('#finDate').value,currency=box.querySelector('#finCurrency').value;
        if(!description) return {error:t('finNeedDescription')};
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {error:t('finNeedDate')};
        const amountMinor=financeParseAmount(box.querySelector('#finAmount').value,currency);
        if(amountMinor===null) return {error:t(currency==='IQD'?'finNeedIqd':'finNeedUsd')};
        const supplierName=box.querySelector('#finSupplier').value.trim();
        const notes=box.querySelector('#finNotes').value.trim();
        if(description.length>160 || supplierName.length>160 || notes.length>1000) return {error:t('finInvalid')};
        const matching=state.suppliers.filter(s=>s.name===supplierName);
        pending={id,operationId,date,description,currency,amountMinor,category:box.querySelector('#finCategory').value,paymentMethod:box.querySelector('#finPayment').value,supplierId:matching.length===1?matching[0].id:null,supplierName,notes,...(row?{expectedRevision:row.revision}:{})};
      }
      const reply=await financeWrite(row?'finance/'+encodeURIComponent(id):'finance',row?'PUT':'POST',pending,epoch,session);
      if(!financeSessionValid(epoch,session) || reply.stale) return {error:t('sessionEnded')};
      if(!reply.ok){
        if(reply.status===400 || reply.localFailure){pending=null;return {error:financeError(reply)};}
        financeLockDraft(box);return {error:financeError(reply)};
      }
      toast(t('finSaved'));financeLoad();return {};
    }
  });
}
function financeVoidForm(row){
  if(!row || row.status==='void') return;
  const epoch=financeState.epoch,session=apiSession();if(!financeSessionValid(epoch,session)) return;
  if(financePendingEntries().some(entry=>entry.path.startsWith('finance/'+row.id))){showAlert(esc(t('finRecoveryHint')));return;}
  const operationId=crypto.randomUUID();let box,pending=null;
  showFormModal({title:esc(t('finVoid')),okLabel:t('finVoid'),banner:esc(t('finVoidHint')),bodyHtml:`<p><bdi>${esc(row.description)}</bdi> · <bdi>${esc(financeAmount(row.amountMinor,row.currency))}</bdi></p>${financeField('finVoidReason','finVoidReason','<textarea id="finVoidReason" rows="3" maxlength="300" dir="auto"></textarea>')}`,
    onOpen:el=>{box=el;},onSubmit:async()=>{
      if(!financeSessionValid(epoch,session)) return {error:t('sessionEnded')};
      if(!pending){
        const reason=box.querySelector('#finVoidReason').value.trim();if(!reason) return {error:t('finNeedReason')};
        if(reason.length>300) return {error:t('finInvalid')};
        if(!await showConfirm(esc(t('finVoidConfirm')), {okLabel:t('finVoid')})) return {keepOpen:true};
        if(!financeSessionValid(epoch,session)) return {error:t('sessionEnded')};
        pending={operationId,expectedRevision:row.revision,reason};
      }
      const reply=await financeWrite('finance/'+encodeURIComponent(row.id)+'/void','POST',pending,epoch,session);
      if(!financeSessionValid(epoch,session) || reply.stale) return {error:t('sessionEnded')};
      if(!reply.ok){if(reply.status===400 || reply.localFailure) pending=null;else financeLockDraft(box);return {error:financeError(reply)};}
      toast(t('finVoidSaved'));financeLoad();return {};
    }
  });
}
function financeChangeHtml(event){
  const before=event.before,after=event.after;
  const fields=[['description','finDescription'],['date','finDate'],['amountMinor','finAmount'],['category','finCategory'],['paymentMethod','finPayment'],['supplierName','finSupplier'],['notes','finNotes'],['status','finStatus'],['voidReason','finVoidReason']];
  const value=(row,key)=>{
    if(!row) return '—';
    if(key==='amountMinor') return financeAmount(row.amountMinor,row.currency);
    if(key==='category') return financeLabel('finCat',row.category);
    if(key==='paymentMethod') return financeLabel('finPay',row.paymentMethod);
    if(key==='status') return row.status==='void'?t('finVoided'):t('finStatusActive');
    return row[key] || '—';
  };
  const changes=fields.filter(([key])=>!before || before[key]!==after?.[key] || key==='amountMinor' && before.currency!==after?.currency).map(([key,label])=>`<div class="fin-change-field"><b>${esc(t(label))}</b>${before?`<span dir="auto">${esc(value(before,key))}</span><span aria-hidden="true">→</span>`:''}<span dir="auto">${esc(value(after,key))}</span></div>`).join('');
  return `<article class="fin-change glass"><div class="fin-meta">${esc(financeLabel('finAction',event.action))} · ${esc(accountLabel(event.actor))} · ${esc(formatIraqDateTime(event.at,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</div>${changes}</article>`;
}
async function financeChanges(row){
  if(!row) return;
  const epoch=financeState.epoch,session=apiSession();if(!financeSessionValid(epoch,session)) return;
  const path='finance/'+encodeURIComponent(row.id)+'/events';
  const reply=await api(path+'?limit=20&offset=0');
  if(!financeSessionValid(epoch,session) || reply.stale) return;
  if(!reply.ok || !Array.isArray(reply.data?.events)){toast(t('loadFailed'));return;}
  let events=reply.data.events,hasMore=reply.data.hasMore,loading=false,nextOffset=reply.data.events.length;
  const body=()=>`${events.map(financeChangeHtml).join('') || emptyState(esc(t('finNoChanges')))}${hasMore?`<button type="button" class="btn btn-ghost fin-more" id="finChangesMore">${esc(t('finMore'))}</button>`:''}<p id="finChangesStatus" role="status"></p>`;
  showFormModal({title:esc(t('finChanges')),cancelLabel:t('finClose'),okLabel:t('finClose'),bodyHtml:`<div id="finChangesList">${body()}</div>`,onSubmit:async()=>({}),onOpen:box=>{
    box.querySelector('#modalFormCancel').hidden=true;
    box.querySelector('#finChangesList').onclick=async event=>{
      const button=event.target.closest('#finChangesMore');if(!button || loading) return;
      loading=true;button.disabled=true;button.setAttribute('aria-busy','true');
      const next=await api(path+'?limit=20&offset='+nextOffset);
      if(!box.isConnected || !financeSessionValid(epoch,session) || next.stale) return;
      loading=false;
      if(!next.ok || !Array.isArray(next.data?.events)){button.disabled=false;button.removeAttribute('aria-busy');box.querySelector('#finChangesStatus').textContent=t('loadFailed');return;}
      nextOffset+=next.data.events.length;
      events=events.concat(next.data.events.filter(change=>!events.some(old=>old.id===change.id)));hasMore=next.data.hasMore;box.querySelector('#finChangesList').innerHTML=body();
    };
  }});
}
function financeCsvCell(value){
  let str=String(value ?? '');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(str)) str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}
function financeCsv(rows){
  const columns=['date','description','category','currency','amount','paymentMethod','supplierName','notes','status','voidReason','createdBy','createdAt','updatedBy','updatedAt','id','revision'];
  const lines=[columns.map(financeCsvCell).join(',')];
  for(const row of rows){
    const values={...row,amount:financeInputAmount(row)};
    lines.push(columns.map(key=>financeCsvCell(values[key])).join(','));
  }
  return '\uFEFF'+lines.join('\r\n');
}
async function financeExport(){
  const epoch=financeState.epoch,session=apiSession(),filterKey=JSON.stringify(financeState.filters),rows=[];
  if(!financeSessionValid(epoch,session)) return;
  if(!financeFiltersValid()){toast(t('finDateRange'));return;}
  let offset=0,expectedTotal=null,ledgerVersion=null;
  while(true){
    const reply=await api(financeQuery(offset));
    if(!financeSessionValid(epoch,session) || reply.stale || JSON.stringify(financeState.filters)!==filterKey) return;
    if(!reply.ok || !Array.isArray(reply.data?.expenses)){toast(t('finExportFailed'));return;}
    if(expectedTotal===null){expectedTotal=reply.data.total;ledgerVersion=reply.data.ledgerVersion;}
    if(typeof ledgerVersion!=='string' || ledgerVersion!==reply.data.ledgerVersion || expectedTotal!==reply.data.total){toast(t('finExportChanged'));return;}
    rows.push(...reply.data.expenses);offset+=reply.data.expenses.length;
    if(!reply.data.hasMore) break;
    if(!reply.data.expenses.length || offset>10000){toast(t('finExportFailed'));return;}
  }
  if(rows.length!==expectedTotal || new Set(rows.map(r=>r.id)).size!==rows.length){toast(t('finExportChanged'));return;}
  const blob=new Blob([financeCsv(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`ricotta-expenses-${financeToday()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('finExported'));
}
