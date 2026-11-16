/* Recipe alerts, for everyone who can open Recipes (Rozh and Ahmad always, Yunis when Rozh gave him
   Recipes): one short message in the inbox and one notification, at most, each time it runs. Each
   alert goes once per change (app_recipe_alert_state keeps what was said):
     price   a stock item's last price rose: the recipes using it cost more (was and now)
     margin  a recipe now loses money (its cost reaches its menu price) or its margin fell under 60%
     stock   a stock item a recipe uses is out, or low, in Main Storage
     link    an ingredient's stock item is no longer in Ricotta Restaurant (renamed or removed)
     missing a recipe not edited for 6 hours still has lines without a cost (no amount or price)
   Runs after the server reads Ricotta Restaurant (stock every 5 minutes, invoices every 15) and after
   Rico on the Mac saves the lists. The first run only notes how things stand. Never fails the work
   that called it. */
import { loadBook } from "./recipes.ts";

const env = (k: string) => (globalThis as any).Deno?.env?.get?.(k) ?? "";
const RC = () => (globalThis as any).RicottaRecipeCost;
const SL = () => (globalThis as any).RicottaStockLink;
type Lang = "en" | "ku" | "ar";
type Words = Record<Lang, string>;
const MISSING_AFTER_MS = 6 * 3600_000;
const MAX_LINES = 4;
const iso = (s: string) => `⁨${s}⁩`;
const money = (n: number, cur: string) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: cur === "USD" ? 2 : 0 }) + " " + cur;
const RANK: Record<string, number> = { none: 0, ok: 0, low: 1, loss: 2, empty: 2 };
const names = (list: string[], lang: Lang) => list.slice(0, 3).map(iso).join(lang === "en" ? ", " : "، ") + (list.length > 3 ? (lang === "en" ? ` and ${list.length - 3} more` : lang === "ku" ? ` و ${list.length - 3} ی تر` : ` و${list.length - 3} أخرى`) : "");

/* What each alert says now, for every key (pure, so it can be tested). */
export function alertInputs(book: any, now = Date.now()) {
  const live = book.recipes.filter((r: any) => !r.archived);
  const usedIngredients = new Set(live.flatMap((r: any) => (r.data?.lines ?? []).map((l: any) => l?.ingredient)));
  const items: { k: string; v: string }[] = [];
  const stockUsed = new Set<string>();
  for (const i of book.ingredients) if (usedIngredients.has(i.id) && i.stock_item) stockUsed.add(i.stock_item);
  for (const name of stockUsed) {
    const p = book.ctx.price(name);
    if (p && p.perBase > 0) items.push({ k: `price:${name}`, v: `${p.currency}:${Number(p.perBase.toPrecision(10))}` });
    const t = book.ctx.titem(name);
    if (t) items.push({ k: `stock:${name}`, v: RC().stockState(t, book.lowNames) });
  }
  if (book.titems.length) for (const i of book.ingredients) items.push({ k: `link:${i.id}`, v: book.ctx.titem(i.stock_item) ? "ok" : "gone" });
  for (const r of live) {
    const cost = RC().recipeCost(r, book.ctx);
    items.push({ k: `margin:${r.id}`, v: cost.state });
    if (now - Date.parse(r.updated_at) >= MISSING_AFTER_MS) items.push({ k: `missing:${r.id}`, v: cost.lines.length && cost.missing ? "missing" : "ok" });
  }
  return items;
}

/* The changes that deserve an alert, as plain events (pure). */
export function alertEvents(changes: { alert_key: string; was: string | null; is_now: string }[], book: any) {
  const live = book.recipes.filter((r: any) => !r.archived);
  const byIng = new Map(book.ingredients.map((i: any) => [i.id, i]));
  const recipesUsing = (stock: string) => live.filter((r: any) => (r.data?.lines ?? []).some((l: any) => (byIng.get(l?.ingredient) as any)?.stock_item === stock));
  const events: any[] = [];
  for (const ch of changes) {
    const [kind, ...rest] = ch.alert_key.split(":"), id = rest.join(":");
    if (kind === "price" && ch.was) {
      const [cw, vw] = ch.was.split(":"), [cn, vn] = ch.is_now.split(":");
      if (cw !== cn || !(Number(vn) > Number(vw) * (1 + 1e-6))) continue;
      const oldCtx = { ...book.ctx, price: (n: string) => n === id ? { ...book.ctx.price(n), perBase: Number(vw) } : book.ctx.price(n) };
      const recipes = recipesUsing(id).map((r: any) => ({ name: r.name, was: RC().recipeCost(r, oldCtx), now: RC().recipeCost(r, book.ctx) }))
        .filter((x: any) => x.now.perServing && x.was.perServing && x.now.perServing > x.was.perServing)
        .map((x: any) => ({ name: x.name, was: x.was.perServing, now: x.now.perServing, currency: x.now.currency }));
      const ing = book.ingredients.find((i: any) => i.stock_item === id);
      if (recipes.length) events.push({ kind: "price", name: ing?.name || id, recipes });
    } else if (kind === "margin" && RANK[ch.is_now] > RANK[ch.was ?? "none"]) {
      const r = live.find((x: any) => x.id === id);
      if (!r) continue;
      const cost = RC().recipeCost(r, book.ctx);
      events.push({ kind: ch.is_now === "loss" ? "loss" : "low", name: r.name, cost: cost.perServing, price: cost.price, margin: cost.margin, currency: cost.currency, min: RC().MARGIN_MIN });
    } else if (kind === "stock" && RANK[ch.is_now] > RANK[ch.was ?? "ok"]) {
      const ing = book.ingredients.find((i: any) => i.stock_item === id);
      events.push({ kind: ch.is_now, name: ing?.name || id, recipes: recipesUsing(id).map((r: any) => r.name) });
    } else if (kind === "link" && ch.is_now === "gone") {
      const i: any = byIng.get(id);
      if (!i) continue;
      const better = SL().suggest({ name: i.stock_item, aliases: [i.name] }, book.titems, 1)[0];
      events.push({ kind: "gone", name: i.name, stock: i.stock_item, maybe: better?.name || null });
    } else if (kind === "missing" && ch.is_now === "missing") {
      const r = live.find((x: any) => x.id === id);
      if (r) events.push({ kind: "missing", name: r.name, count: RC().recipeCost(r, book.ctx).missing });
    }
  }
  return events;
}

/* One line per event, in English, Kurdish and Arabic. */
function line(e: any, lang: Lang): string {
  const n = iso(e.name);
  if (e.kind === "price") {
    const list = e.recipes.slice(0, 3).map((r: any) => lang === "en" ? `${iso(r.name)} ${money(r.was, r.currency)} to ${money(r.now, r.currency)}` : lang === "ku" ? `${iso(r.name)} لە ${money(r.was, r.currency)} بۆ ${money(r.now, r.currency)}` : `${iso(r.name)} من ${money(r.was, r.currency)} إلى ${money(r.now, r.currency)}`).join(lang === "en" ? "; " : "؛ ");
    return lang === "en" ? `${n} went up. Cost per serving: ${list}.` : lang === "ku" ? `نرخی ${n} بەرز بووەوە. تێچووی هەر بەشێک: ${list}.` : `ارتفع سعر ${n}. تكلفة الحصة: ${list}.`;
  }
  if (e.kind === "loss") return lang === "en" ? `${n} is losing money: it costs ${money(e.cost, e.currency)} and sells for ${money(e.price, e.currency)}.`
    : lang === "ku" ? `${n} زیان دەکات: تێچووی ${money(e.cost, e.currency)}، نرخی فرۆشتنی ${money(e.price, e.currency)}.` : `${n} يخسر: تكلفته ${money(e.cost, e.currency)} وسعر بيعه ${money(e.price, e.currency)}.`;
  if (e.kind === "low") return lang === "en" ? `${n} margin is ${e.margin}%, under ${e.min}%.` : lang === "ku" ? `ڕێژەی قازانجی ${n}: ${e.margin}%، کەمتر لە ${e.min}%.` : `هامش ربح ${n}: ${e.margin}%، أقل من ${e.min}%.`;
  if (e.kind === "empty") return lang === "en" ? `${n} is out in Main Storage (used in ${names(e.recipes, lang)}).` : lang === "ku" ? `${n} لە کۆگای سەرەکی نەماوە (لە ${names(e.recipes, lang)} بەکاردێت).` : `نفد ${n} من المخزن الرئيسي (يُستخدم في ${names(e.recipes, lang)}).`;
  if (e.kind === "low_stock" || e.kind === "low" + "Stock") return "";
  if (e.kind === "lowstock") return "";
  if (e.kind === "gone") {
    const maybe = e.maybe ? (lang === "en" ? ` It may now be called ${iso(e.maybe)}.` : lang === "ku" ? ` لەوانەیە ئێستا ناوی ${iso(e.maybe)} بێت.` : ` ربما أصبح اسمه ${iso(e.maybe)}.`) : "";
    return (lang === "en" ? `${iso(e.stock)} is no longer in Ricotta Restaurant. Link ${n} again.` : lang === "ku" ? `${iso(e.stock)} لە ریکۆتا ڕێستۆرانت نەماوە. ${n} دووبارە ببەستەوە.` : `لم يعد ${iso(e.stock)} موجودًا في ريكوتا ريستورانت. اربط ${n} من جديد.`) + maybe;
  }
  if (e.kind === "missing") return lang === "en" ? `${n}: ${e.count} ${e.count === 1 ? "ingredient has" : "ingredients have"} no cost yet.` : lang === "ku" ? `${n}: ${e.count} پێکهاتە هێشتا تێچوویان نییە.` : `${n}: ${e.count} من المكونات بلا تكلفة بعد.`;
  return "";
}
function stockLine(e: any, lang: Lang) {
  return lang === "en" ? `${iso(e.name)} is low in Main Storage (used in ${names(e.recipes, lang)}).` : lang === "ku" ? `${iso(e.name)} لە کۆگای سەرەکی کەمە (لە ${names(e.recipes, lang)} بەکاردێت).` : `${iso(e.name)} منخفض في المخزن الرئيسي (يُستخدم في ${names(e.recipes, lang)}).`;
}
/* The message: the most important first (losing money, then prices, stock, links, missing), at most
   four lines and how many more. null when there is nothing to say. */
export function alertWords(events: any[]): Words | null {
  if (!events.length) return null;
  const order = ["loss", "price", "low", "empty", "stockLow", "gone", "missing"];
  const list = events.map((e) => (e.kind === "low" && e.recipes ? { ...e, kind: "stockLow" } : e)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const say = (lang: Lang) => {
    const shown = list.slice(0, MAX_LINES).map((e) => e.kind === "stockLow" ? stockLine(e, lang) : line(e, lang)).filter(Boolean);
    const more = list.length - Math.min(list.length, MAX_LINES);
    return shown.join(" ") + (more > 0 ? (lang === "en" ? ` And ${more} more in Recipes.` : lang === "ku" ? ` و ${more} ی تر لە ڕەچەتەکان.` : ` و${more} أخرى في الوصفات.`) : "");
  };
  return { en: say("en"), ku: say("ku"), ar: say("ar") };
}

/* Who can open Recipes: Rozh and Ahmad always, Yunis when Rozh gave him Recipes. */
export function recipeAccounts(rows: any[]) {
  const roles = (id: string) => (rows ?? []).find((r: any) => r.id === id)?.roles;
  return ["rozha", "ahmad", "yunis"].filter((a) => a !== "yunis" || (Array.isArray(roles(a)) && roles(a).includes("recipes")));
}

/* Returns how many events were sent. */
export async function checkRecipeAlerts(db: any): Promise<number> {
  try {
    const book = await loadBook(db);
    if (!book.recipes.some((r: any) => !r.archived)) return 0;
    const items = alertInputs(book);
    if (!items.length) return 0;
    const { count, error: countError } = await db.from("app_recipe_alert_state").select("key", { count: "exact", head: true });
    if (countError) return 0;   // before the recipe costs migration
    const { data: changes, error } = await db.rpc("app_internal_recipe_alert_take", { p_items: items });
    if (error || !changes?.length || !count) return 0;   // the first run only notes how things stand
    const events = alertEvents(changes, book);
    const w = alertWords(events);
    if (!w) return 0;
    const { data: people } = await db.from("app_accounts").select("id,roles");
    const to = recipeAccounts(people ?? []);
    const { error: inboxError } = await db.from("app_rico_inbox").insert(to.map((account) => ({ account, kind: "recipe", mood: "calm", body_en: w.en, body_ku: w.ku, body_ar: w.ar })));
    if (inboxError) console.error("recipe_alert_inbox_failed");
    const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), secret = env("CRON_SECRET");
    if (url && secret) {
      await fetch(`${url}/functions/v1/send-push`, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, "x-cron-secret": secret },
        body: JSON.stringify({ type: "recipe", bodyEn: w.en, bodyKu: w.ku, bodyAr: w.ar }),
      }).catch(() => console.error("recipe_alert_push_failed"));
    }
    return events.length;
  } catch {
    console.error("recipe_alert_check_failed");
    return 0;
  }
}
