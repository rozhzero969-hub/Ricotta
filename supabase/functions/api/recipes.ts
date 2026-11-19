// The shared recipe book (Recipes tab), for whoever can open Recipes (index.ts checks the role first).
//   GET    recipes                         recipes, ingredients, Manage's units, stock items, last prices
//                                          (the app works each cost out with _shared/recipe-cost.js) and
//                                          this account's recipe alerts
//   PUT    recipes/:id                     {name, data, version}   one recipe (versions stop one cook
//                                          overwriting another's edits). data: {category, price, lines,
//                                          steps, notes}; nothing else is needed or kept. category is
//                                          the id of one of the prepared categories (or empty): a recipe
//                                          never makes a category. They are made by asking Rico
//                                          (recipe-categories.ts), and GET recipes lists them
//   DELETE recipes/:id                     one recipe and its photos, for good
//   PUT    recipe-ingredients/:id          {name, stock_item, unit, category, version} an ingredient,
//                                          linked to a stock item in Ricotta Restaurant
//   DELETE recipe-ingredients/:id          one no recipe uses; while a recipe uses it the answer is
//                                          409 {error: "ingredient_in_use", recipes: [their names]}
//   POST   recipes/alerts/read             this account's recipe alerts are read
//   GET|POST recipes/:id/photos, DELETE recipes/:id/photos/:photo
//   PUT    recipes/:id/photos/order        {ids} the photos in Ahmad's order (the first is the tile)
// Each new recipe and each new item, and each one deleted, goes in the Record (app_audit_events, types
// "recipe" and "ingredient"), so Rozh sees what Ahmad did.
// Ahmad adds every recipe himself (nothing is imported). Units only come from Manage, Units: this route
// never creates one. Costs are worked out here, from the last price paid in Ricotta Restaurant.
import "../_shared/search.js";
import "../_shared/transfers.js";
import "../_shared/stock-link.js";
import "../_shared/recipe-cost.js";
import { catalogOf } from "./receipts.ts";

type Ctx = { db: any; json: (v: unknown, s?: number) => Response; fail: (v: string, s?: number) => Response; account: string; device?: string | null };
const WHO: Record<string, string> = { rozha: "Rozh", yunis: "Yunis", ahmad: "Ahmad" };
/* One line in the Record. Never fails the save that called it. A new recipe's line uses the recipe's own
   id, so its name follows the next saves (it is saved as it is typed, and its first save can hold half
   a name). */
async function audit(c: Ctx, action: "add" | "delete", type: "recipe" | "ingredient", name: string, fields: { k: string; from?: string; to?: string }[] = [], id?: string) {
  try {
    const { error } = await c.db.from("app_audit_events").insert({ id: id ?? crypto.randomUUID(), actor: c.account, device_id: c.device ?? null, action, entity_type: type, entity_name: name,
      payload: { by: WHO[c.account] ?? c.account, fields, source: "server" } });
    if (error) console.error("recipe_audit_failed");
  } catch { console.error("recipe_audit_failed"); }
}
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

/* A recipe as the app gets it: its category (a column, so deleting a category empties it by itself) sits
   in data.category as the category's id, or "" for none. */
export function shapeRecipe(row: any) {
  const { category_id, ...rest } = row ?? {};
  return { ...rest, data: { ...(rest.data ?? {}), category: category_id ?? "" } };
}
export const CATEGORY_COLUMNS = "id,name,color,sort";
/* The recipe columns the API reads. app_recipes.archived is being retired (2026-11-19, stage 1): the API
   no longer reads or writes it, so the planned migration that drops it (supabase/pending) changes nothing
   here. */
export const RECIPE_COLUMNS = "id,name,data,version,updated_by,updated_at,category_id";
export async function loadCategories(db: any) {
  const r = await db.from("app_recipe_categories").select(CATEGORY_COLUMNS).order("sort").order("name").limit(200);
  if (r.error) throw new Error("load_failed");
  return r.data ?? [];
}

/* Everything a recipe's cost needs, read once: the recipes, their categories, ingredients, units,
   Ricotta Restaurant's items, the invoices kept (the last 60 days) and the low stock levels. */
export async function loadBook(db: any) {
  const [r, i, u, cat, inv, low, categories] = await Promise.all([
    db.from("app_recipes").select(RECIPE_COLUMNS).order("updated_at", { ascending: false }).limit(500),
    db.from("app_recipe_ingredients").select("*").order("name").limit(2000),
    db.from("app_units").select("id,en").order("id").limit(1000),
    catalogOf(db),
    db.from("app_rr_invoices").select("entry_date,read_at,invoice_number,supplier_name,currency,rate,total,delivery_fee,lines").order("entry_date", { ascending: false }).limit(3000),
    db.from("app_items").select("stock_item,stock_items,low_alert").not("low_alert", "is", null).limit(5000),
    loadCategories(db),
  ]);
  if (r.error || i.error || u.error) throw new Error("load_failed");
  const titems = (cat?.titems ?? []).filter((t: any) => t?.name && String(t.name).trim() !== "-");
  const ctx = RC().context({ ingredients: i.data, titems, units: u.data, invoices: inv.error ? [] : inv.data });
  const catNames = new Map<string, string>(categories.map((c: any) => [c.id, c.name]));
  return { recipes: (r.data ?? []).map(shapeRecipe), categories, catName: (x: any) => catNames.get(x?.data?.category) ?? "", ingredients: i.data ?? [], units: u.data ?? [], titems, stockAt: cat?.at ?? null, ctx,
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
  const r = await db.from("app_recipe_photos").select("recipe_id,path,created_at,sort_order").in("recipe_id", ids).order("sort_order").order("created_at").limit(4000);
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
    const [alerts, covers, named] = await Promise.all([
      table("rico_inbox").select("id,body_en,body_ku,body_ar,created_at,read_at").eq("account", c.account).eq("kind", "recipe").order("created_at", { ascending: false }).limit(20),
      coverPhotos(db, book.recipes.map((x: any) => x.id)),
      table("items").select("name,aliases,stock_item,stock_items").limit(5000),
    ]);
    // The other names each stock item goes by (the ordering items linked to it and their search names),
    // only as words to find it by when an item is linked: Arabic or a short name finds "Almarai Milk".
    const aka = new Map<string, Set<string>>();
    for (const it of named.error ? [] : named.data ?? []) for (const n of SL().linksOf(it)) {
      const words = aka.get(n) ?? new Set<string>();
      for (const w of [it.name, ...(Array.isArray(it.aliases) ? it.aliases : [])]) if (typeof w === "string" && w.trim() && w.length <= 120 && words.size < 12) words.add(w.trim());
      aka.set(n, words);
    }
    const used = new Set(book.ingredients.map((x: any) => x.stock_item));
    const prices: Record<string, unknown> = {};
    for (const [name, p] of book.ctx.prices) if (used.has(name)) prices[name] = p;
    return json({
      recipes: book.recipes, categories: book.categories, ingredients: book.ingredients, units: book.units,
      // Ricotta Restaurant's items for linking: names, units, and how each stands in Main Storage.
      stock: book.titems.map((t: any) => ({ name: t.name, base: t.base, count: t.count ?? null, buy: t.buy ?? null, state: RC().stockState(t, book.lowNames), ...(aka.has(t.name) ? { aka: [...aka.get(t.name)!] } : {}) })),
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
    const category = b.category === undefined || b.category === null ? "" : typeof b.category === "string" && b.category.trim().length <= 60 ? b.category.trim() : null;
    if (!uuid(id) || !name || !stock || !unit || category === null || !Number.isInteger(b.version) || b.version < 0) return fail("invalid_input");
    const [cat, units] = await Promise.all([catalogOf(db), table("units").select("id").eq("id", unit).maybeSingle()]);
    if (units.error) return fail("load_failed", 503);
    // Units come only from Manage, Units: an unknown one is refused, never created here.
    if (!units.data) return fail("unknown_unit", 422);
    if (!(cat.titems || []).some((x: any) => x.name === stock)) return fail("invalid_stock_link", 422);
    const row = { name, stock_item: stock, unit, category, updated_at: new Date().toISOString() };
    const r = await (b.version === 0 ? table("recipe_ingredients").insert({ id, ...row }) : table("recipe_ingredients").update({ ...row, version: b.version + 1 }).eq("id", id).eq("version", b.version)).select();
    if (r.error || !r.data?.length) return fail("recipe_conflict", 409);
    if (b.version === 0) await audit(c, "add", "ingredient", name, [{ k: "stock", to: stock }]);
    return json(r.data[0]);
  }
  if (ing && M === "DELETE") {
    const id = ing[1];
    const { data: rows, error } = await table("recipes").select("id,name,data").order("name").limit(500);
    if (error) return fail("load_failed", 503);
    // An item a recipe uses can't be deleted: the answer names the recipes, so the app can say which.
    const users = (rows ?? []).filter((r: any) => (r.data?.lines ?? []).some((l: any) => l?.ingredient === id)).map((r: any) => r.name);
    if (users.length) return json({ error: "ingredient_in_use", recipes: users.slice(0, 20), count: users.length }, 409);
    const old = await table("recipe_ingredients").select("name,stock_item").eq("id", id).maybeSingle();
    const r = await table("recipe_ingredients").delete().eq("id", id);
    if (r.error) return fail("save_failed", 503);
    if (old.data) await audit(c, "delete", "ingredient", old.data.name, [{ k: "stock", from: old.data.stock_item }]);
    return json({ ok: true });
  }
  const match = path.match(/^recipes\/([0-9a-f-]+)(?:\/(photos)(?:\/([0-9a-f-]+|order))?)?$/i);
  if (!match || !uuid(match[1])) return fail("not_found", 404);
  const id = match[1];
  if (!match[2] && M === "PUT") {
    // A recipe is its name, category, menu price, ingredients with amounts, steps and notes. Fields the
    // old form had (servings, times, draft or ready) are not needed any more and are not kept.
    // An app from before 2026-11-16.5 may still send "archived": it is accepted and ignored.
    const name = str(b.name, 120), d = b.data;
    const price = d?.price === null || d?.price === undefined || d?.price === "" ? null : d.price;
    const notes = d?.notes ?? "", category = d?.category ?? "";
    if (!name || !d || typeof d !== "object" || !Number.isInteger(b.version) || b.version < 0
      || !Array.isArray(d.lines) || d.lines.length > 100 || !Array.isArray(d.steps) || d.steps.length > 60 || d.steps.some((s: any) => typeof s !== "string" || s.length > 3000)
      || typeof notes !== "string" || notes.length > 8000 || typeof category !== "string" || category.length > 60
      || (price !== null && (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE || Number(price.toFixed(2)) !== price))) return fail("invalid_input");
    const lines = d.lines.map(cleanLine);
    const [ingredients, units, cats] = await Promise.all([table("recipe_ingredients").select("id,unit").limit(2000), table("units").select("id").limit(1000), table("recipe_categories").select("id,name").limit(200)]);
    if (ingredients.error || units.error || cats.error) return fail("load_failed", 503);
    // The category is one of the prepared ones, by its id. One deleted a moment ago leaves the recipe
    // without a category; a name is still understood (an app from before this update sends names), but
    // a name that is not on the list is refused: categories are only made by asking Rico.
    const want = category.trim();
    const cat = !want ? null : (cats.data ?? []).find((x: any) => x.id === want) ?? (uuid(want) ? null : (cats.data ?? []).find((x: any) => String(x.name).toLowerCase() === want.toLowerCase()));
    if (cat === undefined) return fail("unknown_category", 422);
    const unitIds = new Set((units.data ?? []).map((u: any) => u.id));
    const before = b.version ? await table("recipes").select("data").eq("id", id).maybeSingle() : { data: null, error: null };
    if (before.error) return fail("load_failed", 503);
    // A line's unit is one from Manage, Units, or the unit it was saved with before units came from there.
    const kept = new Set(((before.data?.data?.lines) ?? []).map((l: any) => `${l?.ingredient}|${l?.unit}`));
    const known = (l: any) => unitIds.has(l.unit) || kept.has(`${l.ingredient}|${l.unit}`) || ingredients.data.some((i: any) => i.id === l.ingredient && i.unit === l.unit);
    if (lines.some((l: any) => !uuid(l.ingredient) || !ingredients.data.some((i: any) => i.id === l.ingredient) || !qtyOk(l.qty) || !l.unit || !known(l))) return fail("invalid_ingredients", 422);
    const clean = { lines, steps: d.steps, notes, price, currency: "IQD" };   // recipes are in IQD only
    const group = cat ? [{ k: "recipeGroup", to: cat.name }] : [];
    const row = { name, data: clean, category_id: cat?.id ?? null, updated_by: c.account, updated_at: new Date().toISOString() };
    const r = await (b.version === 0 ? table("recipes").insert({ id, ...row }) : table("recipes").update({ ...row, version: b.version + 1 }).eq("id", id).eq("version", b.version)).select(RECIPE_COLUMNS);
    if (r.error || !r.data?.length) return fail("recipe_conflict", 409);
    if (b.version === 0) await audit(c, "add", "recipe", name, group, id);
    else if (b.version < 40) {
      // The Record line of a recipe added a moment ago follows its name and group as Ahmad types them.
      const { error } = await table("audit_events").update({ entity_name: name, payload: { by: WHO[c.account] ?? c.account, fields: group, source: "server" } })
        .eq("id", id).eq("action", "add").gte("occurred_at", new Date(Date.now() - 3 * 3600_000).toISOString());
      if (error) console.error("recipe_audit_name_failed");
    }
    return json(shapeRecipe(r.data[0]));
  }
  const recipe = await table("recipes").select("id,name").eq("id", id).maybeSingle();
  if (recipe.error) return fail("load_failed", 503);
  if (!recipe.data) return fail("not_found", 404);
  if (!match[2] && M === "DELETE") {
    // Its photos first (files in the private bucket, then their rows), then the recipe itself.
    const photos = await table("recipe_photos").select("id,path").eq("recipe_id", id).limit(50);
    if (photos.error) return fail("load_failed", 503);
    const paths = (photos.data ?? []).map((p: any) => p.path).filter(Boolean);
    if (paths.length) {
      const removed = await db.storage.from(bucket).remove(paths);
      if (removed.error) return fail("save_failed", 503);
      const gone = await table("recipe_photos").delete().eq("recipe_id", id);
      if (gone.error) return fail("save_failed", 503);
    }
    const r = await table("recipes").delete().eq("id", id);
    if (r.error) return fail("save_failed", 503);
    await audit(c, "delete", "recipe", recipe.data.name);
    return json({ ok: true });
  }
  if (match[2] && !match[3] && M === "GET") {
    const r = await table("recipe_photos").select("*").eq("recipe_id", id).order("sort_order").order("created_at");
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
    // A new photo goes last.
    const last = await table("recipe_photos").select("sort_order").eq("recipe_id", id).order("sort_order", { ascending: false }).limit(1);
    const r = await table("recipe_photos").insert({ id: photo, recipe_id: id, path: key, caption: str(b.caption, 200), sort_order: (Number(last.data?.[0]?.sort_order) || 0) + 1 });
    if (r.error) { await store.remove([key]); return fail("save_failed", 503); }
    return json({ ok: true });
  }
  if (match[3] === "order" && M === "PUT") {
    // Ahmad dragged the photos into a new order: ids, first one first (it becomes the recipe's tile).
    const ids = Array.isArray(b.ids) ? b.ids.filter(uuid) : null;
    if (!ids || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length) return fail("invalid_input");
    const have = await table("recipe_photos").select("id").eq("recipe_id", id);
    if (have.error) return fail("load_failed", 503);
    const mine = new Set((have.data ?? []).map((p: any) => p.id));
    if (ids.some((x: string) => !mine.has(x))) return fail("invalid_input");
    const results = await Promise.all(ids.map((x: string, n: number) => table("recipe_photos").update({ sort_order: n + 1 }).eq("id", x).eq("recipe_id", id)));
    return results.some((x: any) => x.error) ? fail("save_failed", 503) : json({ ok: true });
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

/* Rico's read tool for the recipe book (assistant.ts, tool "recipes"): the list, or one recipe with its
   ingredients, amounts, steps, notes, category, menu price and cost, by the same rules and rounding as
   the Recipes tab. Only recipe data: no stock amounts, orders or invoices beyond the last price each
   ingredient's cost comes from. */
const unitWords: Record<string, string> = { kg: "1 kg", g: "1 g", l: "1 L", ml: "1 ml", piece: "1 piece" };
function costWords(c: any) {
  return { cost_to_make_iqd: c.cost, menu_price_iqd: c.price, profit_iqd: c.profit, margin_percent: c.margin, suggested_price_iqd: c.suggested,
    state: c.state, no_cost_because: c.complete ? null : c.lines.length ? c.problems.map((p: any) => `${p.name || "an ingredient"}: ${p.status === "amount" ? "no amount written" : p.status === "unit" ? "its unit can't be turned into the stock item's unit" : "no price yet (no purchase found)"}`) : ["no ingredients yet"] };
}
export async function ricoRecipes(db: any, a: any) {
  let book;
  try { book = await loadBook(db); } catch { return { error: "load_failed", note: "The recipe book could not be read just now. Say so briefly." }; }
  const L = (globalThis as any).RicottaSearch;
  const ctx = book.ctx, recipes = book.recipes;
  const fold = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();
  const q = fold(a?.recipe ?? a?.query ?? "");
  const rules = "Costs, profit and suggested prices are rounded to the nearest 250 IQD; the margin comes from the rounded numbers. A recipe with any ingredient without a price has no cost, profit or margin: say which ingredient has no price yet instead of guessing.";
  if (a?.action === "ingredients") {
    // Every item and ingredient: its stock item, last price paid (per kg, g, L, ml or piece) and the
    // recipes it is in. query narrows by name or stock item.
    const list = book.ingredients.filter((i: any) => !q || fold(i.name + " " + i.stock_item).includes(q)).slice(0, 120).map((i: any) => {
      const p = ctx.price(i.stock_item), ok = p && !p.error && p.currency === "IQD";
      return { name: i.name, stock_item: i.stock_item, last_price: ok ? { paid_iqd: p.cost, per: p.unit, day: p.day, supplier: p.supplier || null,
          price_per_unit: RC().unitPrices(p).map((u: any) => `${u.unit === "other" ? "1 " + u.name : unitWords[u.unit]} = ${Number(u.amount.toPrecision(6))} IQD`) } : null,
        no_price: ok ? null : "no purchase found yet", used_in: recipes.filter((r: any) => (r.data?.lines ?? []).some((l: any) => l?.ingredient === i.id)).map((r: any) => r.name) };
    });
    return { ingredients: list, total: book.ingredients.length, rules };
  }
  if (a?.action !== "read") {
    const list = recipes.filter((r: any) => !q || fold(r.name + " " + book.catName(r)).includes(q)
      || (r.data?.lines ?? []).some((l: any) => fold(book.ingredients.find((i: any) => i.id === l?.ingredient)?.name ?? "").includes(q))).slice(0, 80).map((r: any) => {
      const c = RC().recipeCost(r, ctx);
      return { name: r.name, category: book.catName(r) || null, ingredients: (r.data?.lines ?? []).length, ...costWords(c) };
    });
    return { recipes: list, total: recipes.length, categories: book.categories.map((x: any) => x.name), rules };
  }
  let r = recipes.find((x: any) => fold(x.name) === q);
  if (!r && q) r = L.rank(recipes, q, (x: any) => [x.name, book.catName(x)])[0];
  if (!r) return { error: "not_found", recipes: recipes.map((x: any) => x.name).slice(0, 80), note: "No recipe has that name. Offer the closest names from this list." };
  const c = RC().recipeCost(r, ctx);
  const lines = c.lines.map((l: any) => {
    const p = l.stockItem ? ctx.price(l.stockItem) : null;
    const per = RC().unitPrices(p).map((u: any) => `${u.unit === "other" ? "1 " + u.name : unitWords[u.unit]} = ${Number(u.amount.toPrecision(6))} IQD`);
    return { ingredient: l.name, stock_item: l.stockItem || null, amount: l.qty, unit: l.unit, line_cost_iqd: l.status === "ok" ? l.cost : null,
      last_price: p && !p.error && p.currency === "IQD" ? { paid_iqd: p.cost, per: p.unit, day: p.day, supplier: p.supplier || null, price_per_unit: per } : null,
      problem: l.status === "ok" ? null : l.status };
  });
  return { name: r.name, category: book.catName(r) || null, ingredients: lines, steps: (r.data?.steps ?? []).filter((s: string) => s.trim()), notes: r.data?.notes || "",
    exact_cost_iqd: c.total, ...costWords(c), last_edited: r.updated_at, rules };
}
