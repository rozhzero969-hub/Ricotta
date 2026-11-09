/* Receipts from a photo: the paper invoice is read by an AI (Gemini first, then Claude Haiku) into the
   receipt form, with names only from Ricotta Restaurant's own lists. Nothing is sent: the person checks
   the form and sends it as usual. Keys stay on the server. */
import { config } from "./assistant.ts";
import { catalogOf } from "./receipts.ts";

const GEMINI_MODEL = "gemini-3.5-flash-lite", CLAUDE_MODEL = "claude-haiku-5-5";

export async function scanReceipt(db: any, image: string) {
  if (typeof image !== "string" || image.length < 1000 || image.length > 4_000_000) return { error: "invalid_photo" };
  const cat: any = await catalogOf(db);
  const items = (cat.items ?? []) as any[];
  const unitsOf = (i: any) => [i.base, ...(i.units ?? []).map((u: any) => `${u.name} (${Number(u.factor)}×)`)].join(" | ");
  const prompt = `Read this photo of a supplier's receipt (Kurdish, Arabic or English) for the restaurant "Ricotta" in Erbil.
Return JSON only: {"supplier": string|null, "invoice": string|null, "currency": "IQD"|"USD", "delivery": number|null, "lines": [{"item": string, "unit": string, "qty": number, "cost": number}]}
- supplier: exactly one name from SUPPLIERS that matches, or null.
- invoice: the invoice number, digits only, or null.
- item: exactly one name from ITEMS (left of "=>"), the closest match; leave a line out if nothing matches.
- unit: exactly one of that item's units (right of "=>"), the one the receipt counts in.
- qty: the amount in that unit; cost: the price of ONE unit (not the line total). Numbers only.
SUPPLIERS:
${(cat.suppliers ?? []).join("\n")}
ITEMS:
${items.map((i) => `${i.name} => ${unitsOf(i)}`).join("\n")}`;
  const k = await config(db);
  let text = "";
  if (k.geminiKey) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k.geminiKey }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
    }).catch(() => null);
    if (r?.ok) text = ((await r.json())?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  }
  if (!text && k.anthropicKey) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": k.anthropicKey, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text: prompt }] }] }),
    }).catch(() => null);
    if (r?.ok) text = ((await r.json())?.content ?? []).map((c: any) => c.text ?? "").join("");
  }
  if (!text) return { error: "scan_unavailable" };
  let got: any;
  try { got = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return { error: "scan_unreadable" }; }
  // Only names that are really in the lists; anything else is left for the person.
  const byName = new Map(items.map((i) => [i.name, i]));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null);
  const lines = (Array.isArray(got.lines) ? got.lines : []).slice(0, 60).map((l: any) => {
    const item = byName.get(String(l?.item ?? ""));
    if (!item) return null;
    const label = item.base === l.unit ? "" : (item.units ?? []).map((u: any) => `${u.name} (${Number(u.factor)}×)`).find((x: string) => x === l.unit) ?? "";
    return { item: item.name, unit: label, qty: num(l.qty), cost: num(l.cost) };
  }).filter(Boolean);
  return {
    supplier: (cat.suppliers ?? []).includes(got.supplier) ? got.supplier : null,
    invoice: /^[0-9]{1,30}$/.test(String(got.invoice ?? "")) ? String(got.invoice) : null,
    currency: got.currency === "USD" ? "USD" : "IQD", delivery: num(got.delivery), lines,
  };
}
