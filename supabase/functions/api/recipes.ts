// The shared recipe book (Recipes tab), for whoever can open Recipes (index.ts checks the role first).
//   GET    recipes                         recipes, ingredients, Manage's units, stock items, last prices
//                                          (the app works each cost out with _shared/recipe-cost.js) and
//                                          this account's recipe alerts
//   PUT    recipes/:id                     {name, data, archived, version}   one recipe (versions stop
//                                          one cook overwriting another's edits)
//   PUT    recipe-ingredients/:id          {name, stock_item, unit, version} an ingredient, linked to a
//                                          stock item in Ricotta Restaurant
//   DELETE recipe-ingredients/:id          one no recipe uses
//   POST   recipes/alerts/read             this account's recipe alerts are read
//   GET|POST recipes/:id/photos, DELETE recipes/:id/photos/:photo
// Ahmad adds every recipe himself (nothing is imported). Units only come from Manage, Units: this route
// never creates one. Costs are worked out here, from the last price paid in Ricotta Restaurant.
import "../_shared/search.js";
import "../_shared/transfers.js";
import "../_shared/stock-link.js";
import "../_shared/recipe-cost.js";
import { catalogOf } from "./receipts.ts";

type Ctx = { db: any; json: (v: unknown, s?: number) => Response; fail: (v: string, s?: number) => Response; account: string };
const RC = () => (globalThis as any).RicottaRecipeCost;
const SL = () => (globalThis as any).RicottaStockLink;
const uuid = (v: any) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const str = (v: any, n: number) => typeof v === "string" && v.trim().length <= n ? v.trim() : "";
const bucket = "recipe-photos";
const MAX_PRICE = 1_000_000_000;

/* The stock item names at or below a low stock level Rozh set on an ordering item linked to them
   (several links: their amounts added together, as on the Order screen). */
export function lowStockNames(rows: any[], titems: any[]) {
  const L = SL(), by = new Map((titems ?? []).map((t: any) => [t.name, t])), out = new Set<string>();
  for (const r of rows ?? []) {
    const level = L.lowLevel(r?.low_alert);
    if (level === null) continue;
    const names = L.linksOf(r).filter((n: string) => by.has(n));
    if (!names.length) continue;
    const count = names.length === 1 ? L.counted(by.get(names[0])) : L.combine(names.map((n: string) => by.get(n))).count;
    if (count.qty <= level + 1e-9) names.forEach((n: string) => out.add(n));
  }
  return out;
}

/* Everything a recipe's cost needs, read once: the recipes, ingredients, units, Ricotta Restaurant's
   items, the invoices kept (the last 60 days) and the low stock levels. */
export async function loadBook(db: any) {
  const [r, i, u, cat, inv, low] = await Promise.all([
    db.from("app_recipes").select("*").order("updated_at", { ascending: false }).limit(500),
    db.from("app_recipe_ingredients").select("*").order("name").limit(2000),
    db.from("app_units").select("id,en").order("id").limit(1000),
    catalogOf(db),
    db.from("app_rr_invoices").select("entry_date,read_at,invoice_number,supplier_name,currency,lines").order("entry_date", { ascending: false }).limit(3000),
    db.from("app_items").select("stock_item,stock_items,low_alert").not("low_alert", "is", null).limit(5000),
  ]);
  if (r.error || i.error || u.error) throw new Error("load_failed");
  const titems = (cat?.titems ?? []).filter((t: any) => t?.name && String(t.name).trim() !== "-");
  const ctx = RC().context({ ingredients: i.data, titems, units: u.data, invoices: inv.error ? [] : inv.data });
  return { recipes: r.data ?? [], ingredients: i.data ?? [], units: u.data ?? [], titems, stockAt: cat?.at ?? null, ctx,
    pricesReady: !inv.error, lowNames: lowStockNames(low.error ? [] : low.data, titems) };
}

/* A line kept as {ingredient, qty, unit}: qty a number with at most 3 decimals, or null while Ahmad
   has not written it yet (a draft only). */
function cleanLine(l: any) {
  const qty = l?.qty === null || l?.qty === undefined || l?.qty === "" ? null : l.qty;
  return { ingredient: l?.ingredient, qty, unit: typeof l?.unit === "string" ? l.unit : "" };
}
const qtyOk = (q: any) => q === null || (Number.isFinite(q) && q > 0 && q <= 999999 && Number(q.toFixed(3)) === q);

/* The first photo of each recipe, for its tile in the list: {recipeId: signed url}, valid 15 minutes.
   One signed-url call for all of them; a recipe without a photo gets a plain tile in the app. */
async function coverPhotos(db: any, ids: string[]) {
  if (!ids.length) return {};
  const r = await db.from("app_recipe_photos").select("recipe_id,path,created_at").in("recipe_id", ids).order("created_at").limit(4000);
  if (r.error || !r.data?.length) return {};
  const first = new Map<string, string>();
  for (const p of r.data) if (!first.has(p.recipe_id)) first.set(p.recipe_id, p.path);
  const signed = await db.storage.from(bucket).createSignedUrls([...first.values()], 900).catch(() => null);
  if (!signed || signed.error || !Array.isArray(signed.data)) return {};
  const url = new Map(signed.data.filter((x: any) => x?.signedUrl && !x.error).map((x: any) => [x.path, x.signedUrl]));
  return Object.fromEntries([...first].filter(([, path]) => url.has(path)).map(([id, path]) => [id, url.get(path)]));
}

export async function recipesRoute(c: Ctx, M: string, path: string, b: any) {
  const { db, json, fail } = c, table = (s: string) => db.from("app_" + s);
  if (M === "GET" && path === "recipes") {
    let book;
    try { book = await loadBook(db); } catch { return fail("load_failed", 503); }
    const [alerts, covers] = await Promise.all([
      table("rico_inbox").select("id,body_en,body_ku,body_ar,created_at,read_at").eq("account", c.account).eq("kind", "recipe").order("created_at", { ascending: false }).limit(20),
      coverPhotos(db, book.recipes.map((x: any) => x.id)),
    ]);
    const used = new Set(book.ingredients.map((x: any) => x.stock_item));
    const prices: Record<string, unknown> = {};
    for (const [name, p] of book.ctx.prices) if (used.has(name)) prices[name] = p;
    return json({
      recipes: book.recipes, ingredients: book.ingredients, units: book.units,
      // Ricotta Restaurant's items for linking: names, units, and how each stands in Main Storage.
      stock: book.titems.map((t: any) => ({ name: t.name, base: t.base, count: t.count ?? null, buy: t.buy ?? null, state: RC().stockState(t, book.lowNames) })),
      prices, pricesReady: book.pricesReady, stockAt: book.stockAt, marginMin: RC().MARGIN_MIN,
      covers,
      alerts: alerts.error ? [] : (alerts.data ?? []).map((a: any) => ({ id: a.id, en: a.body_en, ku: a.body_ku, ar: a.body_ar, at: a.created_at, read: !!a.read_at })),
    });
  }
  if (M === "POST" && path === "recipes/alerts/read") {
    const { error } = await table("rico_inbox").update({ read_at: new Date().toISOString() }).eq("account", c.account).eq("kind", "recipe").is("read_at", null);
    return error ? fail("save_failed", 503) : json({ ok: true });
  }
  const ing = path.match(/^recipe-ingredients\/([0-9a-f-]{36})$/i);
  if (ing && M === "PUT") {
    const id = ing[1], name = str(b.name, 120), stock = str(b.stock_item, 200), unit = str(b.unit, 80);
    if (!uuid(id) || !name || !stock || !unit || !Number.isInteger(b.version) || b.version < 0) return fail("invalid_input");
    const [cat, units] = await Promise.all([catalogOf(db), table("units").select("id").eq("id", unit).maybeSingle()]);
    if (units.error) return fail("load_failed", 503);
    // Units come only from Manage, Units: an unknown one is refused, never created here.
    if (!units.data) return fail("unknown_unit", 422);
    if (!(cat.titems || []).some((x: any) => x.name === stock)) return fail("invalid_stock_link", 422);
    const row = { name, stock_item: stock, unit, updated_at: new Date().toISOString() };
    const r = await (b.version === 0 ? table("recipe_ingredients").insert({ id, ...row }) : table("recipe_ingredients").update({ ...row, version: b.version + 1 }).eq("id", id).eq("version", b.version)).select();
    return r.error || !r.data?.length ? fail("recipe_conflict", 409) : json(r.data[0]);
  }
  if (ing && M === "DELETE") {
    const id = ing[1];
    const { data: rows, error } = await table("recipes").select("id,data").limit(500);
    if (error) return fail("load_failed", 503);
    if ((rows ?? []).some((r: any) => (r.data?.lines ?? []).some((l: any) => l?.ingredient === id))) return fail("ingredient_in_use", 409);
    const r = await table("recipe_ingredients").delete().eq("id", id);
    return r.error ? fail("save_failed", 503) : json({ ok: true });
  }
  const match = path.match(/^recipes\/([0-9a-f-]+)(?:\/(photos)(?:\/([0-9a-f-]+))?)?$/i);
  if (!match || !uuid(match[1])) return fail("not_found", 404);
  const id = match[1];
  if (!match[2] && M === "PUT") {
    const name = str(b.name, 120), d = b.data;
    const price = d?.price === null || d?.price === undefined || d?.price === "" ? null : d.price;
    if (!name || !d || typeof d !== "object" || !Number.isInteger(b.version) || b.version < 0 || typeof b.archived !== "boolean" || !["draft", "ready"].includes(d.status)
      || !Array.isArray(d.lines) || d.lines.length > 100 || !Array.isArray(d.steps) || d.steps.length > 60 || d.steps.some((s: any) => typeof s !== "string" || s.length > 3000)
      || typeof d.notes !== "string" || d.notes.length > 8000 || typeof d.category !== "string" || d.category.length > 60 || typeof d.yieldUnit !== "string" || d.yieldUnit.length > 60
      || !Number.isFinite(d.yield) || d.yield <= 0 || d.yield > 100000 || ![d.prep, d.cook].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)
      || (price !== null && (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE || Number(price.toFixed(2)) !== price))
      || !RC().CURRENCIES.includes(d.currency ?? "IQD")) return fail("invalid_input");
    const lines = d.lines.map(cleanLine);
    const [ingredients, units] = await Promise.all([table("recipe_ingredients").select("id,unit").limit(2000), table("units").select("id").limit(1000)]);
    if (ingredients.error || units.error) return fail("load_failed", 503);
    const unitIds = new Set((units.data ?? []).map((u: any) => u.id));
    const before = b.version ? await table("recipes").select("data").eq("id", id).maybeSingle() : { data: null, error: null };
    if (before.error) return fail("load_failed", 503);
    // A line's unit is one from Manage, Units, or the unit it was saved with before units came from there.
    const kept = new Set(((before.data?.data?.lines) ?? []).map((l: any) => `${l?.ingredient}|${l?.unit}`));
    const known = (l: any) => unitIds.has(l.unit) || kept.has(`${l.ingredient}|${l.unit}`) || ingredients.data.some((i: any) => i.id === l.ingredient && i.unit === l.unit);
    if (lines.some((l: any) => !uuid(l.ingredient) || !ingredients.data.some((i: any) => i.id === l.ingredient) || !qtyOk(l.qty) || !l.unit || !known(l))) return fail("invalid_ingredients", 422);
    if (d.status === "ready" && (!lines.length || lines.some((l: any) => l.qty === null) || !d.steps.some((s: string) => s.trim()))) return fail("incomplete_recipe", 422);
    const clean = { status: d.status, lines, steps: d.steps, notes: d.notes, category: d.category.trim(), yield: d.yield, yieldUnit: d.yieldUnit.trim(), prep: d.prep, cook: d.cook,
      price, currency: d.currency === "USD" ? "USD" : "IQD" };
    const row = { name, data: clean, archived: b.archived, updated_by: c.account, updated_at: new Date().toISOString() };
    const r = await (b.version === 0 ? table("recipes").insert({ id, ...row }) : table("recipes").update({ ...row, version: b.version + 1 }).eq("id", id).eq("version", b.version)).select();
    return r.error || !r.data?.length ? fail("recipe_conflict", 409) : json(r.data[0]);
  }
  const recipe = await table("recipes").select("id").eq("id", id).maybeSingle();
  if (recipe.error) return fail("load_failed", 503);
  if (!recipe.data) return fail("not_found", 404);
  if (match[2] && !match[3] && M === "GET") {
    const r = await table("recipe_photos").select("*").eq("recipe_id", id).order("created_at");
    if (r.error) return fail("load_failed", 503);
    const photos = await Promise.all(r.data.map(async (p: any) => { const signed = await db.storage.from(bucket).createSignedUrl(p.path, 900); return { id: p.id, caption: p.caption, created_at: p.created_at, url: signed.data?.signedUrl || null }; }));
    return json(photos);
  }
  if (match[2] && !match[3] && M === "POST") {
    const count = await table("recipe_photos").select("id", { count: "exact", head: true }).eq("recipe_id", id);
    if (count.error) return fail("save_failed", 503);
    if (count.count >= 8) return fail("too_many_photos", 422);
    if (typeof b.image !== "string" || b.image.length > 4_000_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.image)) return fail("invalid_photo");
    let bytes;
    try { bytes = Uint8Array.from(atob(b.image.split(",")[1]), (ch) => ch.charCodeAt(0)); } catch { return fail("invalid_photo"); }
    if (bytes.length > 3_000_000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return fail("invalid_photo");
    const photo = crypto.randomUUID(), key = id + "/" + photo + ".jpg", store = db.storage.from(bucket);
    const upload = await store.upload(key, bytes, { contentType: "image/jpeg", upsert: false });
    if (upload.error) return fail("upload_failed", 503);
    const r = await table("recipe_photos").insert({ id: photo, recipe_id: id, path: key, caption: str(b.caption, 200) });
    if (r.error) { await store.remove([key]); return fail("save_failed", 503); }
    return json({ ok: true });
  }
  if (match[3] && uuid(match[3]) && M === "DELETE") {
    const p = await table("recipe_photos").select("*").eq("recipe_id", id).eq("id", match[3]).maybeSingle();
    if (p.error) return fail("load_failed", 503);
    if (!p.data) return fail("not_found", 404);
    const removed = await db.storage.from(bucket).remove([p.data.path]);
    if (removed.error) return fail("save_failed", 503);
    const r = await table("recipe_photos").delete().eq("id", p.data.id);
    return r.error ? fail("save_failed", 503) : json({ ok: true });
  }
  return fail("not_found", 404);
}
