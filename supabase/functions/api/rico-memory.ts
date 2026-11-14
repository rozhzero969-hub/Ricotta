// Rico's memories and routines, saved for one account (used by the api routes and by Rico's tools in
// assistant.ts). Plain code with no Deno imports, so the backend smoke tests load it as it is.
import { MAX_ROUTINES } from "../_shared/routines.ts";

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

/* ---------- Memories ----------
   "taught": the person asked Rico to remember it (save_rule, or What Rico remembers). "learned": Rico
   noticed it while chatting (remember), e.g. how this person likes answers. At most MEMORY_CAP per
   account: a new one replaces the oldest learned one; taught ones are only removed by a person.
   The same words are never saved twice, and nothing that looks like a PIN, password or key is kept. */
export const MEMORY_CAP = 60;
// Latin words need word edges; \b does not work in Arabic script, so those are matched as written.
const SECRETISH = { test: (s: string) => /\b(pin|pins|password|passcode|passwd|token|api[ -]?key|secret|otp)\b/i.test(s) || /(کۆدی نهێنی|وشەی نهێنی|وشەی تێپەڕ|رمز سري|الرمز السري|كلمة السر|كلمة المرور)/.test(s) };
export const sameWords = (a: string, b: string) => norm(a).replace(/[.!?،,]+$/g, "") === norm(b).replace(/[.!?،,]+$/g, "");
export async function saveMemory(db: any, account: string, rule: string, source: "taught" | "learned") {
  if (SECRETISH.test(rule)) return { error: "secret" };
  const { data, error } = await db.from("app_rico_rules").select("id,rule,source,created_at").eq("account", account).order("created_at");
  if (error) return { error: "failed" };
  const mine = (data ?? []) as any[];
  if (mine.some((r) => sameWords(r.rule, rule))) return { saved: true, already: true };
  if (mine.length >= MEMORY_CAP) {
    const oldest = mine.find((r) => r.source === "learned");
    if (!oldest) return { error: "too_many" };
    const { error: dropError } = await db.from("app_rico_rules").delete().eq("id", oldest.id);
    if (dropError) return { error: "failed" };
  }
  const { error: insertError } = await db.from("app_rico_rules").insert({ account, rule, source });
  return insertError ? { error: "failed" } : { saved: true };
}
/* ---------- Routines ----------
   Rico's propose_routine shows a card; nothing is saved until the person taps Save (POST rico-routines).
   send-push runs them (see ../_shared/routines.ts). */
export const toRoutine = (r: any) => ({ id: r.id, account: r.account, kind: r.kind, text: r.text, supplierIds: r.supplier_ids ?? [],
  time: r.time, days: (r.days ?? []).map(Number), enabled: r.enabled !== false, lastRunDay: r.last_run_day ?? null, runAt: r.run_at ?? null });
export async function saveRoutine(db: any, account: string, v: any) {
  const { data: mine, error: readError } = await db.from("app_rico_routines").select("*").eq("account", account);
  if (readError) return { error: "failed" };
  // The same routine again (a second tap, or asking twice) gives back the one already saved.
  const at = (x: unknown) => (x ? Date.parse(String(x)) : null);
  const same = (mine ?? []).find((r: any) => r.kind === v.kind && r.time === v.time && sameWords(r.text, v.text) && at(r.run_at) === at(v.run_at)
    && [...(r.supplier_ids ?? [])].sort().join() === [...v.supplier_ids].sort().join());
  if (same) return { routine: toRoutine(same) };
  if ((mine ?? []).length >= MAX_ROUTINES) return { error: "too_many" };
  if (v.kind === "prepare_order") {
    const { data: sups, error } = await db.from("app_suppliers").select("id").in("id", v.supplier_ids);
    if (error) return { error: "failed" };
    if ((sups ?? []).length !== v.supplier_ids.length) return { error: "invalid_input" };
  }
  const { data, error } = await db.from("app_rico_routines").insert({ account, ...v }).select("*").maybeSingle();
  return error || !data ? { error: "failed" } : { routine: toRoutine(data) };
}
