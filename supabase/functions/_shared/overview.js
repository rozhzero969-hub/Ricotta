/* Admin's overview: counts of real orders, receipts and transfers, by Baghdad day.
   Shared by the API (admin/overview, index.ts) and its test (scripts/overview-smoke.mjs). It only counts
   rows it is given: nothing is estimated, averaged into a trend or filled in. A day with no orders is a
   real 0; the API sends no number at all when a table could not be read. */
(function(){
  const DAY_MS = 86400000;
  const dayFmt = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baghdad', year:'numeric', month:'2-digit', day:'2-digit'});
  /* A Baghdad calendar day as YYYY-MM-DD. */
  const baghdadDay = (d)=> dayFmt.format(new Date(d));
  /* The n Baghdad days ending today, oldest first. Baghdad has no summer time, so days are 24 hours. */
  function lastDays(now, n){
    const [y, m, d] = baghdadDay(now).split('-').map(Number);
    const out = [];
    for(let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d) - i * DAY_MS).toISOString().slice(0, 10));
    return out;
  }
  /* Totals of money per currency (receipts are in IQD or USD and the two are never added together). */
  function totals(rows){
    const out = {};
    for(const r of rows){
      const cur = r.currency === 'USD' ? 'USD' : 'IQD';
      const v = Number(r.total);
      if(Number.isFinite(v)) out[cur] = Math.round(((out[cur] || 0) + v) * 1000) / 1000;
    }
    return out;
  }
  const latest = (rows, key)=> rows.reduce((best, r)=> r[key] && (!best || r[key] > best[key]) ? r : best, null);
  const ACTIVE = ['queued', 'filling', 'review', 'approved', 'saving', 'moving'];

  /* rows: orders [{id, sent_at, sent_by}] of the last 31 days, lines [{order_id, supplier_name}] of
     those orders, lastOrder (the newest sent order, any age), receipts [{id, status, supplier, total,
     currency, created_by, saved_at, updated_at, problem}] saved in the last 31 days or still open,
     lastReceipt, transfers [{id, status, from_zone, to_zone, created_by, moved_at, updated_at, problem,
     lines}] moved in the last 31 days or still open, lastTransfer. */
  function summarize({now = new Date(), orders = [], lines = [], lastOrder = null, receipts = [], lastReceipt = null, transfers = [], lastTransfer = null} = {}){
    const days14 = lastDays(now, 14), days30 = lastDays(now, 30);
    const today = days30[days30.length - 1];
    const in7 = new Set(days30.slice(-7)), in30 = new Set(days30);

    const sent = orders.filter(o=>o.sent_at).map(o=>({...o, day:baghdadDay(o.sent_at)}));
    const sent30 = sent.filter(o=>in30.has(o.day));
    const ids30 = new Set(sent30.map(o=>o.id));
    const lines30 = lines.filter(l=>ids30.has(l.order_id));
    const perDay = days14.map(day=>({day, n:sent.filter(o=>o.day === day).length}));
    const bySupplier = new Map();
    for(const l of lines30){ const name = String(l.supplier_name || '').trim() || '?'; bySupplier.set(name, (bySupplier.get(name) || 0) + 1); }
    const todayOrders = sent.filter(o=>o.day === today);
    const newestOrder = latest(sent, 'sent_at') || lastOrder;

    const saved = receipts.filter(r=>r.status === 'saved' && r.saved_at).map(r=>({...r, day:baghdadDay(r.saved_at)}));
    const savedToday = saved.filter(r=>r.day === today), saved7 = saved.filter(r=>in7.has(r.day));
    const newestReceipt = latest(saved, 'saved_at') || lastReceipt;

    const moved = transfers.filter(r=>r.status === 'moved' && r.moved_at).map(r=>({...r, day:baghdadDay(r.moved_at)}));
    const newestTransfer = latest(moved, 'moved_at') || lastTransfer;
    const problemOf = r=>({id:r.id, at:r.updated_at || null, by:r.created_by || null, problem:r.problem || null});

    return {
      readAt: new Date(now).toISOString(), today,
      orders: {
        today: todayOrders.length,
        todayItems: lines.filter(l=>todayOrders.some(o=>o.id === l.order_id)).length,
        last7: sent.filter(o=>in7.has(o.day)).length,
        last30: sent30.length,
        items30: lines30.length,
        perDay,
        suppliers: [...bySupplier].map(([name, n])=>({name, n})).sort((a, b)=>b.n - a.n || a.name.localeCompare(b.name)),
        last: newestOrder ? {at:newestOrder.sent_at, by:newestOrder.sent_by || null} : null,
      },
      receipts: {
        today: savedToday.length, todayTotals: totals(savedToday),
        last7: saved7.length, last7Totals: totals(saved7),
        active: receipts.filter(r=>ACTIVE.includes(r.status)).length,
        problems: receipts.filter(r=>r.status === 'problem').map(r=>({...problemOf(r), supplier:r.supplier || null})),
        last: newestReceipt ? {at:newestReceipt.saved_at, by:newestReceipt.created_by || null, supplier:newestReceipt.supplier || null} : null,
      },
      transfers: {
        today: moved.filter(r=>r.day === today).length,
        last7: moved.filter(r=>in7.has(r.day)).length,
        active: transfers.filter(r=>ACTIVE.includes(r.status)).length,
        problems: transfers.filter(r=>r.status === 'problem').map(r=>({...problemOf(r), to:r.to_zone || null})),
        last: newestTransfer ? {at:newestTransfer.moved_at, by:newestTransfer.created_by || null, to:newestTransfer.to_zone || null} : null,
      },
    };
  }
  globalThis.RicottaOverview = {summarize, baghdadDay, lastDays};
})();
