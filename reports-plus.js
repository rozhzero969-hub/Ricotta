/* The big update: charts, trends, month comparison, the year in the kitchen and milestones. */

/* Orders per day this month, as simple bars. */
function monthChartHtml(){
  const orders = thisMonthOrders();
  if(!orders.length) return '';
  const {last} = daysLeftInMonth();
  const counts = Array.from({length:last}, ()=>0);
  orders.forEach(o=>{ const d = +erbilDate(o.date).slice(8) - 1; if(d >= 0 && d < last) counts[d]++; });
  const max = Math.max(1, ...counts);
  return `<div class="report-sec"><div class="report-sec-title">${esc(t('chartPerDay'))}</div><div class="chart-bars" role="img" aria-label="${esc(t('chartPerDayAlt')(orders.length, daysLeftInMonth().day))}">${counts.map((n, i)=>`<span class="chart-bar${n ? '' : ' none'}" style="--h:${Math.round(n / max * 100)}%;--bi:${i}" title="${i + 1}: ${n}"></span>`).join('')}</div><div class="chart-axis"><span>1</span><span>${last}</span></div></div>`;
}
/* One item's amount per order over the orders kept, as a small line. */
function sparkline(values, w = 120, h = 32){
  if(values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i)=>`${(i / (values.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v - min) / span * (h - 6)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="2.6" fill="currentColor"/></svg>`;
}
/* Is an item going up or down? The newer half of its orders against the older half. */
function itemTrend(id){
  const list = itemAmounts(id);
  if(list.length < 4) return null;
  const half = list.length >> 1, avg = a=>a.reduce((s, v)=>s + v, 0) / a.length;
  const older = avg(list.slice(0, half)), newer = avg(list.slice(-half));
  return {values:list, pct:older ? Math.round((newer / older - 1) * 100) : 0};
}
function trendText(tr){ return !tr ? '' : tr.pct >= 10 ? t('trendUp')(tr.pct) : tr.pct <= -10 ? t('trendDown')(-tr.pct) : t('trendSteady'); }
function trendsHtml(){
  const ids = [...new Set(state.history.flatMap(o=>(o.entries || []).flatMap(e=>e.items || [])).map(it=>it.itemId))];
  const rows = ids.map(id=>({id, tr:itemTrend(id), item:state.items.find(i=>i.id === id)})).filter(x=>x.tr && x.item)
    .sort((a, b)=>Math.abs(b.tr.pct) - Math.abs(a.tr.pct)).slice(0, 5);
  if(!rows.length) return '';
  return `<div class="report-sec"><div class="report-sec-title">${esc(t('trendsTitle'))}</div>${rows.map(x=>`<div class="trend-row"><span dir="auto">${esc(x.item.name)}<small>${esc(trendText(x.tr))}</small></span>${sparkline(x.tr.values)}</div>`).join('')}</div>`;
}

/* ---------- Past months: compare two, and a file for any of them ---------- */
function compareMonthsHtml(a, b){
  const row = (label, x, y)=>{ const d = (Number(x) || 0) - (Number(y) || 0); return `<tr><th scope="row">${esc(label)}</th><td>${Number(x) || 0}</td><td>${Number(y) || 0}</td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; };
  const top = m=>new Map((m.topItems || []).map(x=>[x.name, x]));
  const ta = top(a), tb = top(b), names = [...new Set([...ta.keys(), ...tb.keys()])].slice(0, 8);
  return `<div class="compare-scroll"><table class="compare"><thead><tr><th></th><th scope="col">${esc(monthLabel(a.month))}</th><th scope="col">${esc(monthLabel(b.month))}</th><th scope="col">${esc(t('compareChange'))}</th></tr></thead><tbody>${row(t('reportOrders'), a.orders, b.orders)}${row(t('reportDays'), a.activeDays, b.activeDays)}${row(t('reportLines'), a.lines, b.lines)}${names.map(n=>row(n, ta.get(n)?.times, tb.get(n)?.times)).join('')}</tbody></table></div>`;
}
function openCompareMonths(){
  const list = state.months || [];
  if(list.length < 2) return;
  const options = sel=>list.map((m, i)=>`<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(monthLabel(m.month))}</option>`).join('');
  const {el} = openKitchenSheet('months-sheet', `<div class="sel-title">${esc(t('compareTitle'))}</div><div class="compare-pick"><label class="sr-only" for="cmpA">${esc(t('compareFirst'))}</label><select id="cmpA">${options(0)}</select><label class="sr-only" for="cmpB">${esc(t('compareSecond'))}</label><select id="cmpB">${options(1)}</select></div><div id="cmpOut">${compareMonthsHtml(list[0], list[1])}</div>`, t('compareTitle'));
  const paint = ()=>{ el.querySelector('#cmpOut').innerHTML = compareMonthsHtml(list[+el.querySelector('#cmpA').value], list[+el.querySelector('#cmpB').value]); };
  el.querySelector('#cmpA').onchange = paint; el.querySelector('#cmpB').onchange = paint;
}
/* A past month's report as a PDF, from its summary. */
async function exportPastMonth(m){
  const rows = (m.topItems || []).map((x, i)=>[String(i + 1), x.name, String(x.times), `${Number(x.qty)} ${unitLabel(x.unit)}`]);
  await deliverPdf({title:t('fileMonthTitle')(monthLabel(m.month)), subtitle:t('monthsOrders')(m.orders || 0),
    info:[[t('reportOrders'), String(m.orders || 0)], [t('reportDays'), String(m.activeDays || 0)], [t('reportLines'), String(m.lines || 0)]],
    sections:[{columns:[{label:'#', w:8}, {label:t('fileItem'), w:52}, {label:t('reportOrders'), w:16, align:'end'}, {label:t('fileQty'), w:24, align:'end', bold:true}], rows}]}, `Ricotta ${m.month}`);
}

/* ---------- Your year in the kitchen ---------- */
function yearSummary(year = String(new Date().getFullYear())){
  const months = (state.months || []).filter(m=>String(m.month).startsWith(year));
  const thisYear = thisMonthOrders().filter(o=>erbilDate(o.date).startsWith(year));
  const items = new Map();
  months.forEach(m=>(m.topItems || []).forEach(x=>items.set(x.name, (items.get(x.name) || 0) + (Number(x.times) || 0))));
  thisYear.forEach(o=>(o.entries || []).forEach(e=>(e.items || []).forEach(it=>items.set(it.name, (items.get(it.name) || 0) + 1))));
  const best = [...months].sort((a, b)=>(b.orders || 0) - (a.orders || 0))[0];
  return {year, orders:months.reduce((n, m)=>n + (Number(m.orders) || 0), 0) + thisYear.length, months:months.length, top:[...items].sort((a, b)=>b[1] - a[1]).slice(0, 3), best, streak:Math.max(state.streak?.best || 0, state.streak?.count || 0)};
}
function openYearReview(){
  const y = yearSummary();
  openKitchenSheet('year-sheet', `<div class="year-hero">${ricoFace('excited', 'rico-xl')}<div class="sel-title">${esc(t('yearTitle')(y.year))}</div></div>
    <div class="report-stats"><div><b>${y.orders}</b><span>${esc(t('reportOrders'))}</span></div><div><b>${y.streak}</b><span>${esc(t('yearStreak'))}</span></div>${y.best ? `<div><b>${y.best.orders || 0}</b><span>${esc(t('yearBest')(monthLabel(y.best.month)))}</span></div>` : ''}</div>
    ${y.top.length ? `<div class="report-sec"><div class="report-sec-title">${esc(t('reportTop'))}</div><ol class="year-top">${y.top.map(([n])=>`<li dir="auto">${esc(n)}</li>`).join('')}</ol></div>` : ''}
    <p class="notif-sub">${esc(t('yearHint'))}</p>`, t('yearTitle')(y.year));
}

/* ---------- Kitchen milestones ---------- */
const MILESTONES = [
  {id:'streak7', test:s=>s.streak >= 7}, {id:'streak30', test:s=>s.streak >= 30}, {id:'streak100', test:s=>s.streak >= 100},
  {id:'orders100', test:s=>s.orders >= 100}, {id:'orders500', test:s=>s.orders >= 500}, {id:'orders1000', test:s=>s.orders >= 1000},
];
function milestoneStats(){
  const y = (state.months || []).reduce((n, m)=>n + (Number(m.orders) || 0), 0) + thisMonthOrders().length;
  return {orders:y, streak:Math.max(state.streak?.best || 0, state.streak?.count || 0)};
}
function milestonesHtml(){
  if(!featureOn('milestones')) return '';
  const s = milestoneStats();
  return `<div class="report-sec"><div class="report-sec-title">${esc(t('milestonesTitle'))}</div><div class="milestones">${MILESTONES.map(m=>{ const got = m.test(s); return `<div class="milestone${got ? ' got' : ''}">${got ? ICON_CHECK : ''}<span>${esc(t('ms_' + m.id))}</span></div>`; }).join('')}</div></div>`;
}
/* Says so once when a new one is reached. */
function checkMilestones(){
  if(!featureOn('milestones') || !state.account) return;
  const key = 'milestones:' + state.account, seen = lget(key), s = milestoneStats();
  const got = MILESTONES.filter(m=>m.test(s)).map(m=>m.id);
  if(!Array.isArray(seen)){ lset(key, got); return; }   // what was already reached isn't news
  const fresh = got.filter(id=>!seen.includes(id));
  if(!fresh.length) return;
  lset(key, got);
  toast(t('milestoneNew')(t('ms_' + fresh[fresh.length - 1])), 'ok');
}

/* ---------- A short tour, once for someone new ---------- */
function maybeShowTour(){
  if(!state.account) return;
  const key = 'toured:' + state.account;
  if(lget(key)) return;
  lset(key, true);
  // People who already use the app don't need it; it is still in Settings, Help.
  if(!state.history.some(o=>o.by === state.account)) openTour();
}
function openTour(){
  const steps = [1, 2, 3, 4];
  let i = 0;
  const {el, close} = openKitchenSheet('tour-sheet', '<div id="tourStep"></div>', t('tourBtn'));
  const paint = ()=>{
    const n = steps[i];
    el.querySelector('#tourStep').innerHTML = `<div class="tour-step">${ricoFace(n === 4 ? 'excited' : 'happy', 'rico-xl')}<div class="p-eyebrow">${n} / ${steps.length}</div><div class="sel-title">${esc(t('tour' + n + 'T'))}</div><p class="notif-sub">${esc(t('tour' + n))}</p><button type="button" class="btn btn-primary" id="tourNext">${esc(t(i === steps.length - 1 ? 'tourDone' : 'tourNext'))}</button></div>`;
    el.querySelector('#tourNext').onclick = ()=>{ if(i === steps.length - 1) close(); else { i++; paint(); } };
  };
  paint();
}
