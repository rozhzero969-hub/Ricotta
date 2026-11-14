// Admin, Stock names (Rozh only): problems in Ricotta Restaurant's stock item names, each with the
// corrected name to copy. Nothing is ever renamed here or in Ricotta Restaurant: Rozh fixes them there.
//
// Two kinds of checks:
//  - Rules (instant, exact): double or edge spaces, the " - " between the English and Kurdish names,
//    Arabic letters mixed into Kurdish words (and the other way round), Latin and Kurdish letters glued
//    into one word, two kinds of digits in one name, and a name with only one language.
//  - Spelling, by Rico's AI (Claude Haiku first, then Gemini, then Groq; the AI switches in Admin apply).
//    Rozh approved sending only the item names. The answer is checked (only names we sent, numbers kept
//    exactly, a real change) and kept in app_stock_names so the page opens at once; Check again reruns it.
import { config } from "./assistant.ts";
import { catalogOf } from "./receipts.ts";

const AI_TIMEOUT_MS = 50_000;
const BATCH = 110;
const CLAUDE_MODEL = "claude-haiku-5-5", GEMINI_MODEL = "gemini-3.5-flash-lite", GROQ_MODEL = "openai/gpt-oss-120b";

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;
const KU_LETTERS = /[ەێۆڕڵڤیک]/g;   // ە ێ ۆ ڕ ڵ ڤ ی ک
const AR_LETTERS = /[يكةى]/g;                          // ي ك ة ى
const EAST_DIGITS = /[٠-٩۰-۹]/;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export type NameProblem = { kind: "spacing" | "letters" | "missing" | "spelling"; code: string };

/* The English part and the Kurdish/Arabic part of "English - Kurdish", split at the dash between them. */
const SPLIT = /^(.*?[A-Za-z0-9).\]%'"])(\s*[-–—]\s*)([؀-ۿ٠-٩۰-۹(].*)$/s;

/* Arabic-script words: Kurdish letters and Arabic-only letters in the same part means a mix-up. Letters
   that exist only in Kurdish (ە ێ ۆ ڕ ڵ ڤ) make it Kurdish: ي ى → ی, ك → ک, ة → ە. Without them, the
   more common form wins (ی and ک are also Persian forms). A Kurdish word ending in ه where Kurdish writes
   ە (only when the part already uses ە) is fixed too. */
const KU_ONLY = /[\u06D5\u06CE\u06C6\u0695\u06B5\u06A4]/g;   // ە ێ ۆ ڕ ڵ ڤ
function fixLetters(text: string): { text: string; changed: boolean } {
  const kuOnly = count(text, KU_ONLY), ku = count(text, KU_LETTERS), ar = count(text, AR_LETTERS);
  const kurdish = kuOnly > 0 || ku >= ar;
  let out = text;
  if (ku && ar) {
    out = kurdish
      ? out.replace(/[\u064A\u0649]/g, "\u06CC").replace(/\u0643/g, "\u06A9").replace(/\u0629/g, "\u06D5")
      : out.replace(/\u06CC/g, "\u064A").replace(/\u06A9/g, "\u0643");
  }
  if (kurdish && /\u06D5/.test(out)) out = out.replace(/([\u0600-\u06FF])\u0647(?=$|[\s)\-.,])/g, "$1\u06D5");
  return { text: out, changed: out !== text };
}

/* Every rule problem in one name, and the name with all of them fixed (null when a rule can't fix it). */
export function nameProblems(raw: string): { problems: NameProblem[]; fixed: string } {
  const name = String(raw ?? "");
  const problems: NameProblem[] = [];
  let fixed = name;
  if (/^\s|\s$/.test(fixed)) { problems.push({ kind: "spacing", code: "edges" }); fixed = fixed.trim(); }
  if (/\s{2,}/.test(fixed)) { problems.push({ kind: "spacing", code: "double" }); fixed = fixed.replace(/\s{2,}/g, " "); }
  if (fixed.split(/\s+/).some((w) => LATIN.test(w) && ARABIC_SCRIPT.test(w))) {
    problems.push({ kind: "letters", code: "glued" });
    fixed = fixed.split(" ").map((w) => LATIN.test(w) && ARABIC_SCRIPT.test(w)
      ? w.replace(/([A-Za-z0-9])(?=[\u0600-\u06FF])/g, "$1 ").replace(/([\u0600-\u06FF])(?=[A-Za-z])/g, "$1 ") : w).join(" ");
  }
  const m = fixed.match(SPLIT);
  // English then Kurdish with no dash between them at all: the " - " is added.
  const noDash = !/[-\u2013\u2014]/.test(fixed) && fixed.match(/^([^\u0600-\u06FF]*[A-Za-z0-9).%])\s+([\u0600-\u06FF].*)$/s);
  if (noDash) { problems.push({ kind: "spacing", code: "separator" }); fixed = `${noDash[1]} - ${noDash[2]}`; }
  if (m && m[2] !== " - ") { problems.push({ kind: "spacing", code: "separator" }); fixed = `${m[1].trimEnd()} - ${m[3].trimStart()}`; }
  if (/[0-9]/.test(fixed) && EAST_DIGITS.test(fixed)) {
    problems.push({ kind: "letters", code: "digits" });
    fixed = fixed.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  }
  const parts = fixed.match(SPLIT);
  const local = parts ? parts[3] : ARABIC_SCRIPT.test(fixed) && !LATIN.test(fixed) ? fixed : "";
  if (local) {
    const l = fixLetters(local);
    if (l.changed) { problems.push({ kind: "letters", code: "mixedLetters" }); fixed = parts ? `${parts[1]}${parts[2]}${l.text}` : l.text; }
  }
  if (!LATIN.test(fixed)) problems.push({ kind: "missing", code: "noEnglish" });
  else if (!ARABIC_SCRIPT.test(fixed)) problems.push({ kind: "missing", code: "noLocal" });
  return { problems, fixed };
}

/* The names worth checking: each once, without Ricotta Restaurant's "-" placeholder items. */
export function catalogNames(cat: any): string[] {
  const all = [...(cat?.titems ?? []), ...(cat?.items ?? [])].map((i: any) => String(i?.name ?? ""));
  return [...new Set(all.filter((n) => n.replace(/[\s-]/g, "").length > 0))].sort((a, b) => a.localeCompare(b));
}

async function hashNames(names: string[]) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(names.join("\n")));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* An AI answer is used only where it is safe: a name we sent, a real change, the same numbers. */
const digitsOf = (s: string) => (s.match(/[0-9٠-٩۰-۹]+/g) ?? []).join(",");
export function cleanFixes(reply: unknown, sent: Set<string>) {
  const list = Array.isArray((reply as any)?.fixes) ? (reply as any).fixes : [];
  const out: { name: string; fixed: string; why: string }[] = [];
  for (const f of list.slice(0, 400)) {
    const name = typeof f?.name === "string" ? f.name : "";
    const fixed = typeof f?.fixed === "string" ? f.fixed.replace(/\s+/g, " ").trim() : "";
    const why = typeof f?.why === "string" ? f.why.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    if (!sent.has(name) || !fixed || fixed.length > 160 || /[\n<>]/.test(fixed)) continue;
    if (fixed === nameProblems(name).fixed || fixed === name.trim()) continue;
    if (digitsOf(fixed) !== digitsOf(nameProblems(name).fixed)) continue;
    if (out.some((x) => x.name === name)) continue;
    out.push({ name, fixed, why });
  }
  return out;
}

const PROMPT = (names: string[]) => `These are inventory item names from a restaurant in Erbil, Iraq. Most are written "English - Kurdish (Sorani, Arabic script)"; a few are Arabic.
Find only clear spelling mistakes in the English, Kurdish or Arabic words, and names missing their English or Kurdish part when you can translate them with confidence.
Return JSON only: {"fixes":[{"name": "<the exact name as given>", "fixed": "<the whole corrected name>", "why": "<a few plain English words, e.g. Misspelled: mozarella>"}]}
Rules: keep the "English - Kurdish" format; keep brand names, sizes, numbers and pack counts (like 20*225) exactly; never change a word that is already correct; no style or capital-letter changes; if unsure, leave the name out. An empty list is fine.
NAMES:
${names.join("\n")}`;

async function askAi(k: any, names: string[]): Promise<{ reply: unknown; provider: string } | null> {
  const prompt = PROMPT(names);
  const parse = (text: string) => { try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; } };
  if (k.anthropicKey) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-api-key": k.anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 6000, messages: [{ role: "user", content: prompt }] }),
    }).catch(() => null);
    const reply = r?.ok ? parse(((await r.json())?.content ?? []).map((c: any) => c.text ?? "").join("")) : null;
    if (reply) return { reply, provider: "anthropic" };
  }
  if (k.geminiKey) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-goog-api-key": k.geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
    }).catch(() => null);
    const reply = r?.ok ? parse(((await r.json())?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("")) : null;
    if (reply) return { reply, provider: "gemini" };
  }
  if (k.groqKey) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "content-type": "application/json", "authorization": `Bearer ${k.groqKey}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0 }),
    }).catch(() => null);
    const reply = r?.ok ? parse((await r.json())?.choices?.[0]?.message?.content ?? "") : null;
    if (reply) return { reply, provider: "groq" };
  }
  return null;
}

/* One row per name with a problem: what is wrong (rules and spelling) and the corrected name. */
function rowsFor(names: string[], spelling: { name: string; fixed: string; why: string }[]) {
  const ai = new Map(spelling.map((s) => [s.name, s]));
  const rows: any[] = [];
  for (const name of names) {
    const r = nameProblems(name), s = ai.get(name);
    const problems: NameProblem[] = [...r.problems];
    let fixed: string | null = r.fixed;
    if (s) {
      // The AI's name, with the rules applied to it too (it may keep a double space, for example).
      const tidy = nameProblems(s.fixed).fixed;
      if (tidy !== r.fixed) { problems.push({ kind: "spelling", code: "spelling" }); fixed = tidy; }
    }
    if (!problems.length) continue;
    // A name with only a missing language and no AI suggestion has nothing to copy yet.
    if (fixed === name) fixed = null;
    rows.push({ name, problems, fixed, why: s && problems.some((p) => p.kind === "spelling") ? s.why : "" });
  }
  return rows;
}

export async function stockNames(db: any) {
  const cat: any = await catalogOf(db);
  const names = catalogNames(cat);
  const [{ data: saved, error }, k] = await Promise.all([
    db.from("app_stock_names").select("names_hash,results,provider,checked_at").eq("id", true).maybeSingle(),
    config(db, true),
  ]);
  if (error) throw new Error("stock_names_unavailable");
  const here = new Set(names);
  const spelling = (Array.isArray(saved?.results) ? saved.results : []).filter((s: any) => here.has(s?.name) && typeof s?.fixed === "string");
  return {
    readAt: cat.at ?? null, total: names.length,
    checkedAt: saved?.checked_at ?? null, provider: saved?.provider ?? null,
    stale: !!saved?.checked_at && saved.names_hash !== await hashNames(names),
    aiReady: !!(k.anthropicKey || k.geminiKey || k.groqKey),
    rows: rowsFor(names, spelling),
  };
}

/* Check again: every name to the AI in batches (side by side, so it fits in one request), then saved. */
export async function checkStockNames(db: any) {
  const cat: any = await catalogOf(db);
  const names = catalogNames(cat);
  if (!names.length) return { error: "no_names" };
  const k = await config(db, true);
  if (!(k.anthropicKey || k.geminiKey || k.groqKey)) return { error: "ai_off" };
  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += BATCH) batches.push(names.slice(i, i + BATCH));
  const answers = await Promise.all(batches.map((b) => askAi(k, b)));
  if (answers.every((a) => !a)) return { error: "ai_unavailable" };
  const results = answers.flatMap((a, i) => a ? cleanFixes(a.reply, new Set(batches[i])) : []);
  // Batches the AI could not answer keep their earlier suggestions.
  const { data: before } = await db.from("app_stock_names").select("results").eq("id", true).maybeSingle();
  const missed = new Set(batches.filter((_, i) => !answers[i]).flat());
  const kept = (Array.isArray(before?.results) ? before.results : []).filter((s: any) => missed.has(s?.name));
  const provider = answers.find(Boolean)!.provider;
  const { error } = await db.from("app_stock_names").upsert({
    id: true, names_hash: await hashNames(names), results: [...results, ...kept], provider, checked_at: new Date().toISOString(),
  });
  if (error) throw new Error("stock_names_unavailable");
  return { ...(await stockNames(db)), partial: missed.size > 0 };
}
