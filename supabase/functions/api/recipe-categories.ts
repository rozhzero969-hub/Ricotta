// Recipe categories (Cakes, Smoothies, Iced coffee...): a prepared list in app_recipe_categories. Nobody
// types a category in a form: Rozh and Ahmad ask Rico, and Rico uses the recipe_categories tool here to
// list, add, rename or delete one, or to change its colour. The recipe form then offers the list.
// Each category has one of ten soft colours (_shared/recipe-colors.js), shown behind its recipes' photos.
//   PUT recipe-categories/:id   {color}   the colour a person tapped on Rico's colour card (the only
//                                          change the app makes itself; index.ts checks Recipes access)
// Every add, rename, delete and colour change goes in the Record (type "recipeCategory").
import "../_shared/recipe-colors.js";
import { CATEGORY_COLUMNS, loadCategories } from "./recipes.ts";

type Emit = (event: Record<string, unknown>) => void;
type Ctx = { db: any; json: (v: unknown, s?: number) => Response; fail: (v: string, s?: number) => Response; account: string; device?: string | null };
const COLORS = () => (globalThis as any).RicottaRecipeColors;
const WHO: Record<string, string> = { rozha: "Rozh", yunis: "Yunis", ahmad: "Ahmad" };
const uuid = (v: any) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fold = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();
/* A category name as people write it: one line, no doubled spaces, at most 60 letters. */
const cleanName = (v: unknown) => { const s = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim(); return s.length >= 1 && s.length <= 60 ? s : ""; };

async function audit(db: any, account: string, action: "add" | "edit" | "delete", name: string, fields: { k: string; from?: string; to?: string }[] = []) {
  try {
    const { error } = await db.from("app_audit_events").insert({ id: crypto.randomUUID(), actor: account, device_id: null, action, entity_type: "recipeCategory", entity_name: name,
      payload: { by: WHO[account] ?? account, fields, source: "rico" } });
    if (error) console.error("recipe_category_audit_failed");
  } catch { console.error("recipe_category_audit_failed"); }
}

/* The category someone means: by exact name first, then the closest spelling. */
function findCategory(list: any[], said: unknown) {
  const q = fold(said);
  if (!q) return null;
  return list.find((c) => fold(c.name) === q) ?? (globalThis as any).RicottaSearch?.rank(list, q, (c: any) => [c.name])[0] ?? null;
}

/* The colour card in Rico's chat: the ten colours with their names, the one in use marked. Tapping one
   sets it straight away (PUT recipe-categories/:id). */
function colorCard(c: any, emit: Emit) {
  emit({ type: "proposal", proposal: { id: "rc" + crypto.randomUUID().slice(0, 12), kind: "recipe_colors", categoryId: c.id, category: c.name, color: c.color } });
}

export const RECIPE_CATEGORY_TOOLS = [
  { name: "recipe_categories", description: "The recipe categories (Cakes, Smoothies, Iced coffee...) that recipes are filed under. The recipe form only offers this list, so adding, renaming and deleting a category happens here, when the person asks. "
    + "action 'list': every category with its colour and how many recipes are in it. 'add' with name: a new category (it gets the next free colour). 'rename' with category and new_name. "
    + "'delete' with category: recipes in it are kept and simply have no category; first call it without confirmed to see how many recipes are in it, tell the person, and call again with confirmed true only after they say yes. "
    + "'set_color' with category and color (one of mint, butter, peach, sky, lilac, rose, sand, sage, apricot, mist; everyday words like yellow or pink are understood). "
    + "'colors' with category: shows a card in the chat with the ten colours to tap; use it when they want to choose or see the colours, or the colour they asked for is not one of the ten. "
    + "Category names are written the way the person wrote them (any language). Only accounts that can open Recipes can use this.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["list", "add", "rename", "delete", "set_color", "colors"] }, name: { type: "string" }, category: { type: "string" }, new_name: { type: "string" }, color: { type: "string" }, confirmed: { type: "boolean" } }, required: ["action"] } },
];
export const RECIPE_CATEGORY_TOOL_NAMES = new Set(RECIPE_CATEGORY_TOOLS.map((t) => t.name));
export const RECIPE_CATEGORY_MANUAL = `- Recipe categories: a prepared list (recipe_categories tool). Nobody types a category in the recipe form; when someone wants a new one, or to rename, delete or recolour one, do it with the tool and say it is done. Each category has one of ten soft colours (mint, butter, peach, sky, lilac, rose, sand, sage, apricot, mist), shown behind its recipes' photos; to let them choose, use action 'colors' to show the colour card. Before deleting a category, say how many recipes are in it and ask first.`;

export async function runRecipeCategoryTool(db: any, account: string, a: any, emit: Emit) {
  let list: any[];
  try { list = await loadCategories(db); } catch { return { error: "load_failed", note: "The categories could not be read just now. Say so briefly." }; }
  const action = String(a?.action ?? "list"), C = COLORS();
  const counts = async () => {
    const r = await db.from("app_recipes").select("category_id").limit(2000);
    const n = new Map<string, number>();
    for (const x of r.data ?? []) if (x.category_id) n.set(x.category_id, (n.get(x.category_id) ?? 0) + 1);
    return n;
  };
  const shown = (c: any, n?: Map<string, number>) => ({ name: c.name, color: c.color, ...(n ? { recipes: n.get(c.id) ?? 0 } : {}) });
  if (action === "list") {
    const n = await counts();
    return { categories: list.map((c) => shown(c, n)), colors: C.KEYS, note: list.length ? undefined : "There are no categories yet. Offer to add the ones they need." };
  }
  if (action === "add") {
    const name = cleanName(a?.name ?? a?.new_name ?? a?.category);
    if (!name) return { error: "no_name", note: "Ask for the category's name (at most 60 letters)." };
    if (list.some((c) => fold(c.name) === fold(name))) return { error: "exists", note: `"${name}" is already a category. Say so.` };
    if (list.length >= 200) return { error: "too_many", note: "There are already 200 categories. Suggest deleting ones not in use." };
    const asked = a?.color ? C.find(a.color) : null;
    const color = asked ?? C.next(list.map((c) => c.color));
    const r = await db.from("app_recipe_categories").insert({ name, color, sort: list.reduce((m, c) => Math.max(m, Number(c.sort) || 0), 0) + 1, created_by: account }).select(CATEGORY_COLUMNS);
    if (r.error || !r.data?.length) return { error: "save_failed", note: "It could not be saved just now. Say so briefly." };
    await audit(db, account, "add", name, [{ k: "color", to: color }]);
    return { added: shown(r.data[0]), note: "Say it is added and its colour, and that it is now in the recipe form's category list." };
  }
  const c = findCategory(list, a?.category ?? a?.name);
  if (!c) return { error: "not_found", categories: list.map((x) => x.name), note: list.length ? "No category has that name. Offer the closest from this list." : "There are no categories yet." };
  if (action === "rename") {
    const name = cleanName(a?.new_name);
    if (!name) return { error: "no_name", note: "Ask for the new name (at most 60 letters)." };
    if (list.some((x) => x.id !== c.id && fold(x.name) === fold(name))) return { error: "exists", note: `"${name}" is already another category. Say so.` };
    const r = await db.from("app_recipe_categories").update({ name, updated_at: new Date().toISOString() }).eq("id", c.id).select(CATEGORY_COLUMNS);
    if (r.error || !r.data?.length) return { error: "save_failed", note: "It could not be saved just now. Say so briefly." };
    await audit(db, account, "edit", name, [{ k: "name", from: c.name, to: name }]);
    return { renamed: { from: c.name, to: name }, note: "Say it is renamed; its recipes keep it." };
  }
  if (action === "delete") {
    const inIt = (await counts()).get(c.id) ?? 0;
    if (a?.confirmed !== true) return { needs_confirmation: true, category: c.name, recipes_in_it: inIt, note: inIt ? `Tell them ${inIt} recipe(s) are in it; the recipes stay, without a category. Ask if they want to delete it.` : "It has no recipes. Ask them to confirm, then call again with confirmed true." };
    const r = await db.from("app_recipe_categories").delete().eq("id", c.id);
    if (r.error) return { error: "save_failed", note: "It could not be deleted just now. Say so briefly." };
    await audit(db, account, "delete", c.name);
    return { deleted: c.name, recipes_now_without_category: inIt };
  }
  if (action === "colors") {
    colorCard(c, emit);
    return { shown: true, category: c.name, color: c.color, note: "The colour card is on screen: say they can tap a colour to use it." };
  }
  if (action === "set_color") {
    const color = C.find(a?.color);
    if (!color) { colorCard(c, emit); return { error: "unknown_color", colors: C.KEYS, note: "That is not one of the ten colours. The colour card is on screen: say they can pick one there." }; }
    if (color === c.color) return { unchanged: true, category: c.name, color };
    const r = await db.from("app_recipe_categories").update({ color, updated_at: new Date().toISOString() }).eq("id", c.id).select(CATEGORY_COLUMNS);
    if (r.error || !r.data?.length) return { error: "save_failed", note: "It could not be saved just now. Say so briefly." };
    await audit(db, account, "edit", c.name, [{ k: "color", from: c.color, to: color }]);
    return { category: c.name, color, note: "Say the colour is changed." };
  }
  return { error: "unknown_action" };
}

/* PUT recipe-categories/:id {color}: a colour tapped on Rico's card. */
export async function recipeCategoryRoute(c: Ctx, M: string, path: string, b: any) {
  const m = path.match(/^recipe-categories\/([0-9a-f-]{36})$/i);
  if (!m || !uuid(m[1]) || M !== "PUT") return c.fail("not_found", 404);
  const color = typeof b?.color === "string" && COLORS().KEYS.includes(b.color) ? b.color : null;
  if (!color) return c.fail("invalid_input");
  const old = await c.db.from("app_recipe_categories").select(CATEGORY_COLUMNS).eq("id", m[1]).maybeSingle();
  if (old.error) return c.fail("load_failed", 503);
  if (!old.data) return c.fail("not_found", 404);
  if (old.data.color === color) return c.json(old.data);
  const r = await c.db.from("app_recipe_categories").update({ color, updated_at: new Date().toISOString() }).eq("id", m[1]).select(CATEGORY_COLUMNS);
  if (r.error || !r.data?.length) return c.fail("save_failed", 503);
  await audit(c.db, c.account, "edit", old.data.name, [{ k: "color", from: old.data.color, to: color }]);
  return c.json(r.data[0]);
}
