// Ahmad's Stock tab (the minibar): how much of each item Rozh picked for him is in Main Storage, so he
// knows what he can take before he goes down. Rozh picks the items from the ordering items (Order), and
// only she can change the list; Ahmad sees it, A to Z, with a search box and nothing else.
//   GET minibar          {items: [{id, name, stock}], at}      Ahmad and Rozh
//   PUT minibar          {itemIds: [ids]}                     Rozh only
// The list is kept on Ahmad's account (app_accounts.settings.minibarItems), so no table is needed.
// Rico's minibar_stock tool reads the same list (assistant.ts). Needs RicottaStockLink
// (_shared/stock-link.js) and RicottaTransfers (_shared/transfers.js) loaded first.

const SL = () => (globalThis as any).RicottaStockLink;
export const MINIBAR_MAX = 300;

export async function minibarIds(db: any): Promise<string[]> {
  const { data, error } = await db.from("app_accounts").select("settings").eq("id", "ahmad").maybeSingle();
  if (error) throw error;
  const ids = data?.settings?.minibarItems;
  return Array.isArray(ids) ? ids.filter((x: unknown) => typeof x === "string" && x.length <= 120).slice(0, MINIBAR_MAX) : [];
}

export async function saveMinibar(db: any, ids: string[]) {
  const { data, error } = await db.from("app_accounts").select("settings").eq("id", "ahmad").maybeSingle();
  if (error || !data) return false;
  const r = await db.from("app_accounts").update({ settings: { ...(data.settings ?? {}), minibarItems: ids } }).eq("id", "ahmad");
  return !r.error;
}

/* Each picked item with how much is in Main Storage (one link as on the Order screen; several added
   together), its level (empty, low, ok) and when Rico last read the stock. Items that were deleted
   from the ordering list since are left out. */
export async function minibarStock(db: any) {
  const L = SL();
  const ids = await minibarIds(db);
  if (!ids.length) return { items: [], at: null, picked: 0 };
  const since = new Date(Date.now() - L.USE_DAYS * 86400_000).toISOString();
  const [items, cat, moves] = await Promise.all([
    db.from("app_items").select("id,name,stock_item,stock_items").in("id", ids),
    db.from("app_rr_catalog").select("data,updated_at").eq("id", true).maybeSingle(),
    db.from("app_rr_transfers").select("from_zone,lines,mode").eq("status", "moved").eq("from_zone", L.MAIN).gte("moved_at", since).order("moved_at", { ascending: false }).limit(1500),
  ]);
  if (items.error || cat.error) throw new Error("load_failed");
  const titems: any[] = cat.data?.data?.titems ?? [], at = cat.data?.updated_at ?? null;
  const byName = new Map(titems.map((t: any) => [t.name, t]));
  const used = moves.error ? new Map() : L.usage(moves.data ?? [], titems, L.MAIN);
  const out = (items.data ?? []).map((i: any) => {
    const links = L.linksOf(i), found = links.map((n: string) => byName.get(n)).filter(Boolean);
    let stock: any = null;
    if (!links.length || !found.length) stock = { missing: true };
    else if (found.length === 1) stock = { ...L.amount(found[0]), level: L.level(found[0], used).level };
    else { const c = L.combine(found, used); stock = { multi: true, kinds: c.kinds, empty: c.empty, level: c.level, qty: c.kinds?.[0]?.qty ?? 0, unit: c.kinds?.[0]?.unit ?? "" }; }
    return { id: i.id, name: i.name, stock };
  }).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  return { items: out, at, picked: ids.length };
}
