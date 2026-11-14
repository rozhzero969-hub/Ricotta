/* Stock (read only): how much of each item is in Main Storage in Ricotta Restaurant, as Rico last read
   it. Hovering an item (a computer) shows when it was last bought and last moved; Details shows its
   usage (recipe) unit, buying format and counting format. Nothing can be changed here: items and units
   are edited in Ricotta Restaurant. Excel, PDF and Numbers (a CSV that Numbers and Excel open) download
   the list. Depends on: state, t, esc, api, render, toast, canDo, openKitchenSheet, formatIraqDateTime,
   timeAgo, brandedWorkbook, deliverExcel, deliverPdf, deliverFile, safeFileName, fileDay, fileStamp. */
const stk = {data:null, loading:false, failed:false, sort:'name'};
async function stockLoad(){
  if(stk.loading) return;
  stk.loading = true;
  const r = await api('stock', {quiet:true});
  stk.loading = false;
  if(r.ok && Array.isArray(r.data?.items)){ stk.data = r.data; stk.failed = false; } else if(!stk.data) stk.failed = true;
  if(state.view === 'stock') render();
}
const stkNum = n=>Number(n || 0).toLocaleString('en-US', {maximumFractionDigits:2});
/* The amount in its counting unit (12 کارتۆن), with the usage unit beside it when they differ. */
function stkAmount(i){
  const f = Number(i.count?.factor) || 1, unit = i.count?.name || i.base;
  return {main:stkNum(i.main / f) + ' ' + unit, base:i.count && f !== 1 ? stkNum(i.main) + ' ' + i.base : ''};
}
const stkLine = i=>{ const a = stkAmount(i); return a.main + (a.base ? ' (' + a.base + ')' : ''); };
function stkWhen(at){ return at ? formatIraqDateTime(at, {day:'numeric', month:'short'}) : ''; }
function stkBoughtLine(b){ return b ? t('stockBoughtLine')(stkWhen(b.at), b.supplier || '', stkNum(b.qty) + ' ' + (b.unit || '')) : t('stockNotIn60'); }
function stkMovedLine(m){ return m ? t('stockMovedLine')(stkWhen(m.at), m.to || '', stkNum(m.qty) + ' ' + (m.unit || '')) : t('stockNotIn60'); }
function stkItems(){
  const q = foldText(String(state.catalogQuery || '').trim());
  const list = (stk.data?.items || []).filter(i=>!q || foldText(i.name).includes(q));
  const by = stk.sort === 'low' ? (a, b)=>a.main / (Number(a.count?.factor) || 1) - b.main / (Number(b.count?.factor) || 1) || a.name.localeCompare(b.name) : (a, b)=>a.name.localeCompare(b.name);
  return list.sort(by);
}
function renderStock(){
  if(!stk.data && !stk.loading) stockLoad();
  if(!stk.data) return stk.failed ? emptyState(t('loadFailed')) : loadingLines(6);
  const all = stk.data.items, empty = all.filter(i=>i.main <= 0).length, list = stkItems();
  const exp = canDo('exports') ? `<div class="stk-exports" role="group" aria-label="${esc(t('exportBtn'))}">
      <button type="button" class="btn btn-ghost" data-stk-export="excel">${ICON_SHEET}<span>Excel</span></button>
      <button type="button" class="btn btn-ghost" data-stk-export="pdf">${NAV_ICONS.record}<span>PDF</span></button>
      <button type="button" class="btn btn-ghost" data-stk-export="numbers">${ICON_SHEET}<span>Numbers</span></button></div>` : '';
  // One line per item, like Ricotta Restaurant's Stock page: a dot (green: some left, red: none), the
  // name and the amount with its usage unit. Clicking (or Enter on) a row opens its details.
  const rows = list.map(i=>{
    const none = i.main <= 0;
    return `<div class="stk-row${none ? ' none' : ''}" data-search-row data-stk="${esc(i.name)}" role="button" tabindex="0" aria-label="${esc(i.name)}, ${esc(stkLine(i))}">
      <i class="stk-dot" aria-hidden="true"></i>
      <span class="stk-name" dir="auto">${esc(i.name)}</span>
      <b class="stk-amt" dir="auto">${esc(stkLine(i))}</b></div>`;
  }).join('');
  return `<div class="stk-tools">${renderCatalogSearch()}
      <div class="pill-seg stk-sort" role="radiogroup" aria-label="${esc(t('stockSort'))}">
        <button type="button" class="pill-seg-btn" role="radio" aria-checked="${stk.sort === 'name'}" data-stk-sort="name">${esc(t('stockSortName'))}</button>
        <button type="button" class="pill-seg-btn" role="radio" aria-checked="${stk.sort === 'low'}" data-stk-sort="low">${esc(t('stockSortLow'))}</button></div>
      ${exp}</div>
    <p class="stk-meta">${esc(t('stockMeta')(stk.data.zone ? t('stockMain') : '', all.length, empty, stk.data.at ? timeAgo(new Date(stk.data.at).toISOString()) : ''))}</p>
    ${!stk.data.at ? `<p class="rr-foot warn">${esc(t('rrNoCatalog'))}</p>` : ''}
    ${rows ? `<div class="stk-list">${rows}</div>` : emptyState(t('rrNoMatch'))}
    <p class="stk-note">${esc(t('stockReadOnly'))}</p>`;
}
function attachStockEvents(){
  document.querySelectorAll('[data-stk-sort]').forEach(b=>b.onclick = ()=>{ stk.sort = b.dataset.stkSort; render(); });
  // A row opens its details too (a phone has no hover).
  document.querySelectorAll('.stk-row').forEach(row=>{
    row.onclick = ()=>stockDetails(row.dataset.stk);
    row.onkeydown = e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); stockDetails(row.dataset.stk); } };
  });
  document.querySelectorAll('[data-stk-export]').forEach(b=>b.onclick = ()=>withBusy(b, ()=>stockExport(b.dataset.stkExport)));
  // A computer: resting the pointer on an item shows its last purchase and last transfer.
  if(matchMedia('(hover: hover)').matches) document.querySelectorAll('.stk-row').forEach(row=>{
    row.onmouseenter = ()=>{ clearTimeout(stk.tipTimer); stk.tipTimer = setTimeout(()=>{ if(row.isConnected && row.matches(':hover')) stockTip(row); }, 1000); };
    row.onmouseleave = ()=>{ clearTimeout(stk.tipTimer); document.getElementById('stkTip')?.remove(); };
  });
}
function stockTip(row){
  const i = stk.data?.items.find(x=>x.name === row.dataset.stk); if(!i) return;
  document.getElementById('stkTip')?.remove();
  const tip = document.createElement('div');
  tip.id = 'stkTip'; tip.className = 'stk-tip'; tip.setAttribute('role', 'tooltip');
  tip.innerHTML = `<b class="stk-tip-name" dir="auto">${esc(i.name)}</b><div><span>${esc(t('stockInMain'))}</span><b dir="auto">${esc(i.main <= 0 ? t('stockEmpty') : stkLine(i))}</b></div><div><span>${esc(t('stockLastBought'))}</span><b dir="auto">${esc(stkBoughtLine(i.lastBought))}</b></div><div><span>${esc(t('stockLastMoved'))}</span><b dir="auto">${esc(stkMovedLine(i.lastMoved))}</b></div>`;
  document.body.appendChild(tip);
  const r = row.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const below = r.bottom + 8 + h < innerHeight;
  tip.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + 24)) + 'px';
  tip.style.top = (below ? r.bottom + 6 : r.top - h - 6) + 'px';
}
/* Details: everything about the item's units, read only. */
function stockDetails(name){
  const i = stk.data?.items.find(x=>x.name === name); if(!i) return;
  document.getElementById('stkTip')?.remove();
  const a = stkAmount(i);
  const fmt = u=>u ? `${u.name} = ${stkNum(u.factor)} ${i.base}` : t('stockNotSet');
  const row = (k, v)=>`<div class="stk-d-row"><span>${esc(k)}</span><b dir="auto">${esc(v)}</b></div>`;
  openKitchenSheet('stk-sheet', `<div class="sel-title" dir="auto">${esc(i.name)}</div>
    <div class="stk-d">${row(t('stockInMain'), i.main <= 0 ? t('stockEmpty') : a.main + (a.base ? ' (' + a.base + ')' : ''))}</div>
    <div class="stk-d">${row(t('stockUsage'), i.base || t('stockNotSet'))}${row(t('stockBuy'), fmt(i.buy))}${row(t('stockCount'), fmt(i.count))}</div>
    <div class="stk-d">${row(t('stockLastBought'), stkBoughtLine(i.lastBought))}${row(t('stockLastMoved'), stkMovedLine(i.lastMoved))}</div>
    <p class="stk-note">${esc(t('stockReadOnly'))}</p>`, i.name);
}
async function stockExport(kind){
  const at = new Date(), list = stkItems(), title = t('stockFileTitle'), name = `${title} ${fileDay(at)}`;
  const cells = i=>{ const f = Number(i.count?.factor) || 1; return [i.name, Number((i.main / f).toFixed(3)), i.count?.name || i.base, Number(Number(i.main).toFixed(3)), i.base,
    i.buy ? `${i.buy.name} = ${stkNum(i.buy.factor)} ${i.base}` : '', i.lastBought ? stkWhen(i.lastBought.at) : '', i.lastMoved ? `${stkWhen(i.lastMoved.at)} → ${i.lastMoved.to}` : '']; };
  const head = [t('fileItem'), t('stockInMain'), t('stockCount'), t('stockInBase'), t('stockUsage'), t('stockBuy'), t('stockLastBought'), t('stockLastMoved')];
  try{
    if(kind === 'excel'){
      const columns = head.map((label, k)=>({label, width:[34, 14, 14, 14, 12, 24, 14, 22][k], type:k === 1 || k === 3 ? 'number' : undefined}));
      return await deliverExcel(brandedWorkbook({title, subtitle:t('stockFileSub')(list.length, fileStamp(at)), at, sheets:[{name:title, columns, rows:list.map(cells)}]}), name);
    }
    if(kind === 'numbers'){
      const q = v=>{ const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '﻿' + [head, ...list.map(cells)].map(r=>r.map(q).join(',')).join('\r\n');
      const done = await deliverFile(new Blob([csv], {type:'text/csv;charset=utf-8'}), `${safeFileName(name)}.csv`);
      if(done) toast(t('stockNumbersReady'));
      return done;
    }
    return await deliverPdf({title, subtitle:t('stockFileSub')(list.length, fileStamp(at)), stamp:fileStamp(at), info:[[t('items'), String(list.length)], [t('stockEmpty'), String(list.filter(i=>i.main <= 0).length)]],
      sections:[{columns:[{label:t('fileItem'), w:40, bold:true}, {label:t('stockInMain'), w:22, align:'end'}, {label:t('stockLastBought'), w:16}, {label:t('stockLastMoved'), w:22}],
        rows:list.map(i=>{ const a = stkAmount(i); return [i.name, i.main <= 0 ? t('stockEmpty') : a.main, i.lastBought ? stkWhen(i.lastBought.at) : '·', i.lastMoved ? `${stkWhen(i.lastMoved.at)} → ${i.lastMoved.to}` : '·']; })}]}, name);
  }catch(e){ console.error('Stock export failed', e); toast(t('exportFailed'), 'error'); }
}
