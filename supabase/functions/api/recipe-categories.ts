// Named groups for recipes; the photo determines the appearance.
import { CATEGORY_COLUMNS, loadCategories } from "./recipes.ts";

const WHO: Record<string, string> = { rozha: "Rozh", yunis: "Yunis", ahmad: "Ahmad" };
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

export const RECIPE_CATEGORY_TOOLS = [
  { name: "recipe_categories", description: "The recipe categories (Cakes, Smoothies, Iced coffee...) that recipes are filed under. The recipe form only offers this list, so adding, renaming and deleting a category happens here, when the person asks. "
    + "action 'list': every category with how many recipes are in it. 'add' with name: a new category. 'rename' with category and new_name. "
    + "'delete' with category: recipes in it are kept and simply have no category; first call it without confirmed to see how many recipes are in it, tell the person, and call again with confirmed true only after they say yes. "
    + "Category names are written the way the person wrote them (any language). Only accounts that can open Recipes can use this.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["list", "add", "rename", "delete"] }, name: { type: "string" }, category: { type: "string" }, new_name: { type: "string" }, confirmed: { type: "boolean" } }, required: ["action"] } },
];
export const RECIPE_CATEGORY_TOOL_NAMES = new Set(RECIPE_CATEGORY_TOOLS.map((t) => t.name));
export const RECIPE_CATEGORY_MANUAL = `- Recipe categories are for grouping only. Use recipe_categories to list, add, rename or delete them. Photos determine the recipe's background. Before deleting a category, say how many recipes are in it and ask first.`;

export async function runRecipeCategoryTool(db: any, account: string, a: any, _emit?: unknown) {
  let list: any[];
  try { list = await loadCategories(db); } catch { return { error: "load_failed", note: "The categories could not be read just now. Say so briefly." }; }
  const action = String(a?.action ?? "list");
  if (action === "colors" || action === "set_color") return { error: "retired", note: "Category colors are retired. The recipe photo sets the background." };
  const counts = async () => {
    const r = await db.from("app_recipes").select("category_id").limit(2000);
    const n = new Map<string, number>();
    for (const x of r.data ?? []) if (x.category_id) n.set(x.category_id, (n.get(x.category_id) ?? 0) + 1);
    return n;
  };
  const shown = (c: any, n?: Map<string, number>) => ({ name: c.name, ...(n ? { recipes: n.get(c.id) ?? 0 } : {}) });
  if (action === "list") {
    const n = await counts();
    return { categories: list.map((c) => shown(c, n)), note: list.length ? undefined : "There are no categories yet. Offer to add the ones they need." };
  }
  if (action === "add") {
    const name = cleanName(a?.name ?? a?.new_name ?? a?.category);
    if (!name) return { error: "no_name", note: "Ask for the category's name (at most 60 letters)." };
    if (list.some((c) => fold(c.name) === fold(name))) return { error: "exists", note: `"${name}" is already a category. Say so.` };
    if (list.length >= 200) return { error: "too_many", note: "There are already 200 categories. Suggest deleting ones not in use." };
    const r = await db.from("app_recipe_categories").insert({ name, color: "mist", sort: list.reduce((m, c) => Math.max(m, Number(c.sort) || 0), 0) + 1, created_by: account }).select(CATEGORY_COLUMNS);
    if (r.error || !r.data?.length) return { error: "save_failed", note: "It could not be saved just now. Say so briefly." };
    await audit(db, account, "add", name);
    return { added: shown(r.data[0]), note: "Say it is added and that it is now in the recipe form's category list." };
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
  return { error: "unknown_action" };
}
