// Rico never does the same thing twice: a transfer or receipt Rico already pressed Move it / Save for,
// and the very same transfer sent again, are only sent after the person confirms.
// Run: npx -y deno@2 run --node-modules-dir=none --lock=deno.lock --frozen-lockfile scripts/rico-twice-smoke.ts
import { sendTransfer } from "../supabase/functions/api/transfers.ts";
import { sendReceipt } from "../supabase/functions/api/receipts.ts";

const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error("FAIL: " + msg); };
function fakeDb(tables: Record<string, any[]>) {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({}) },
    from(table: string) {
      let action = "read", change: any;
      const filters: ((r: any) => boolean)[] = [];
      const run = () => {
        const rows = tables[table] ?? (tables[table] = []);
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (action === "update") hit.forEach((r) => Object.assign(r, change));
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const q: any = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(f: string, v: unknown) { filters.push((r) => r[f] === v); return q; },
        neq(f: string, v: unknown) { filters.push((r) => r[f] !== v); return q; },
        in(f: string, v: unknown[]) { filters.push((r) => v.includes(r[f])); return q; },
        not(f: string, _op: string, _v: unknown) { filters.push((r) => r[f] != null); return q; },
        gte() { return q; },
        update(c: any) { action = "update"; change = c; return q; },
        maybeSingle() { const x = run(); return Promise.resolve({ data: x.data[0] ?? null, error: null }); },
        then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
      };
      return q;
    },
  };
}
const titem = { name: "Lemon - لیمۆ", base: "غرام", count: { name: "کیلۆ", factor: 1000 }, buy: { name: "کیلۆ", factor: 1000 }, stock: { "Main Storage": 30000, Appetizers: 0 } };
const catalog = [{ id: true, data: { zones: ["Main Storage", "Appetizers"], titems: [titem], items: [], suppliers: [] }, updated_at: new Date().toISOString() }];
const lines = [{ item: titem.name, unit: "کیلۆ", qty: 6 }];
const draft = (id: string, extra = {}) => ({ id, created_by: "rozha", status: "draft", from_zone: "Main Storage", to_zone: "Appetizers", yesterday: false, lines, log: [], version: 1, ...extra });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// 1. The same transfer already moved today: asked, then sent once confirmed.
{
  const moved = { ...draft("00000000-0000-0000-0000-000000000001"), status: "moved", for_day: day, moved_at: new Date().toISOString() };
  const twin = draft("00000000-0000-0000-0000-000000000002");
  const db = fakeDb({ app_rr_catalog: catalog, app_rr_transfers: [moved, twin] });
  const a = await sendTransfer(db, { ...twin }, "rozha", [], "app");
  assert(a.error === "needs_confirmation" && (a.extra as any).warnings.some((w: any) => w.code === "repeat"), "the same transfer twice is asked about");
  assert(twin.status === "draft", "and not sent");
  const b = await sendTransfer(db, { ...twin }, "rozha", ["repeat"], "app");
  assert(!b.error && twin.status === "queued", "sent once confirmed");
}
// 2. A different amount is not the same transfer; a stopped one Rico never pressed for doesn't count.
{
  const stopped = { ...draft("00000000-0000-0000-0000-000000000003"), status: "problem", for_day: day, pressed_at: null };
  const other = draft("00000000-0000-0000-0000-000000000004", { lines: [{ ...lines[0], qty: 5 }] });
  const same = draft("00000000-0000-0000-0000-000000000005");
  const db = fakeDb({ app_rr_catalog: catalog, app_rr_transfers: [stopped, other, same] });
  assert(!(await sendTransfer(db, { ...other }, "rozha", [], "app")).error, "a different amount goes straight away");
  // "same" matches "stopped" exactly, but Rico never pressed Move it for that one, so it doesn't count.
  // (It does match "other"? No: other has 5, same has 6.)
  assert(!(await sendTransfer(db, { ...same }, "rozha", [], "app")).error, "a stopped one Rico never pressed for doesn't block");
}
// 3. Retry of a transfer Rico pressed Move it for: asked first; the mark is cleared when sent again.
{
  const t = { ...draft("00000000-0000-0000-0000-000000000006"), status: "problem", pressed_at: new Date().toISOString(), for_day: day };
  const db = fakeDb({ app_rr_catalog: catalog, app_rr_transfers: [t] });
  const a = await sendTransfer(db, { ...t }, "rozha", [], "app");
  assert(a.error === "needs_confirmation" && (a.extra as any).warnings.some((w: any) => w.code === "pressed"), "a pressed transfer is asked about");
  const b = await sendTransfer(db, { ...t }, "rozha", ["pressed"], "app");
  assert(!b.error && t.status === "queued" && t.pressed_at === null, "sent once confirmed, mark cleared");
}
// 4. A receipt whose twin (same supplier and invoice) stopped after Save was pressed: asked first.
{
  const rcat = [{ id: true, data: { zones: ["Main Storage"], suppliers: ["Bread House"], items: [{ name: "Bread", base: "دانە", units: [] }] }, updated_at: new Date().toISOString() }];
  const helper = [{ id: true, big_total: 1000000, price_jump: 30, rate_min: 1500, rate_max: 1800 }];
  const base = { created_by: "rozha", supplier: "Bread House", invoice: "77", zone: "Main Storage", currency: "IQD", rate: null, delivery: null, lines: [{ item: "Bread", unit: "دانە", qty: 2, cost: 500 }], log: [], version: 1 };
  const stuck = { ...base, id: "00000000-0000-0000-0000-000000000007", status: "problem", pressed_at: new Date().toISOString() };
  const copy = { ...base, id: "00000000-0000-0000-0000-000000000008", status: "draft", pressed_at: null };
  const db = fakeDb({ app_rr_catalog: rcat, app_rr_helper: helper, app_rr_receipts: [stuck, copy] });
  const a = await sendReceipt(db, { ...copy }, "rozha", [], "app");
  assert(a.error === "needs_confirmation" && (a.extra as any).warnings.some((w: any) => w.code === "pressed"), "a copy of a receipt Rico pressed Save for is asked about");
  const b = await sendReceipt(db, { ...copy }, "rozha", ["pressed"], "app");
  assert(!b.error && copy.status === "queued", "sent once confirmed");
}
console.log("Rico twice PASS: the same transfer, a retry after Move it, and a copy after Save are each asked about first");
