// Rico's routines: a reminder, or an order he prepares by himself, at a time on some weekdays
// (Baghdad time). Used by the api (checking what a person asks for) and by send-push (running them
// from its every-minute tick). Each routine runs at most once a Baghdad day (last_run_day).
//
// Rico NEVER sends anything to a supplier here: a prepared order is put in the person's inbox with
// its lines, and the app offers it as a card that fills the Order screen when they tap it. Sending
// stays on the Order screen, by a person.

export type RoutineKind = "remind" | "prepare_order";
export type Routine = {
  id: string; account: string; kind: RoutineKind; text: string; supplier_ids: string[];
  time: string; days: number[]; enabled: boolean; last_run_day: string | null;
  run_at?: string | null;   // a one-off reminder: when; removed once it has fired
  created_at?: string; updated_at?: string;
};
export type Now = { date: string; minutes: number; weekday: number };
export type Words = { en: string; ku: string; ar: string };

export const MAX_ROUTINES = 20;          // per account
export const RUN_WINDOW_MIN = 3 * 60;    // a missed tick still runs it up to 3 hours late, never later
export const ONCE_MIN_S = 10, ONCE_MAX_DAYS = 30;   // a one-off reminder: 10 seconds to 30 days ahead
const OFFSET = "+03:00";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/* The Baghdad clock time of a moment, "14:05". */
export function baghdadTime(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
/* When a one-off reminder should come, from what Rico read in the message: in_seconds from now, or at
   "HH:MM" (today, or tomorrow if that time has passed) or "YYYY-MM-DD HH:MM", Baghdad time. */
export function whenOnce(a: any, nowMs = Date.now()): number | { error: string } {
  const secs = Number(a?.in_seconds);
  if (a?.in_seconds !== undefined && a?.in_seconds !== null && a?.in_seconds !== "") {
    if (!Number.isFinite(secs) || secs < ONCE_MIN_S || secs > ONCE_MAX_DAYS * 86400) return { error: "when" };
    return nowMs + Math.round(secs) * 1000;
  }
  const at = String(a?.at ?? "").trim();
  let m = at.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (m) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date(nowMs));
    let t = Date.parse(`${today}T${m[1]}:${m[2]}:00${OFFSET}`);
    if (t <= nowMs) t += 86400_000;
    return t;
  }
  m = at.match(/^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/);
  if (m) {
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${OFFSET}`);
    if (!Number.isFinite(t) || t <= nowMs || t > nowMs + ONCE_MAX_DAYS * 86400_000) return { error: "when" };
    return t;
  }
  return { error: "when" };
}

/* What a person (or Rico on their behalf) asked for, checked. Days default to every day. A one-off
   reminder carries run_at (ms or ISO) instead; its time is kept too, for showing. */
export function cleanRoutine(a: any, nowMs = Date.now()): { value: Omit<Routine, "id" | "account" | "enabled" | "last_run_day"> } | { error: string } {
  const kind = a?.kind === "prepare_order" ? "prepare_order" : a?.kind === "remind" ? "remind" : null;
  if (!kind) return { error: "kind" };
  const text = String(a?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return { error: "text" };
  if (a?.run_at !== undefined && a?.run_at !== null) {
    const at = typeof a.run_at === "number" ? a.run_at : Date.parse(String(a.run_at));
    if (kind !== "remind" || !Number.isFinite(at) || at < nowMs - 60_000 || at > nowMs + ONCE_MAX_DAYS * 86400_000) return { error: "when" };
    return { value: { kind, text, time: baghdadTime(at), days: ALL_DAYS, supplier_ids: [], run_at: new Date(at).toISOString() } };
  }
  const time = String(a?.time ?? "").trim();
  if (!TIME.test(time)) return { error: "time" };
  const raw = a?.days === undefined || a?.days === null ? ALL_DAYS : a.days;
  if (!Array.isArray(raw)) return { error: "days" };
  const days = [...new Set(raw.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length || days.length !== new Set(raw.map(Number)).size) return { error: "days" };
  const ids = Array.isArray(a?.supplier_ids) ? [...new Set(a.supplier_ids.map((x: unknown) => String(x ?? "").trim()).filter(Boolean))] as string[] : [];
  if (ids.length > 5 || ids.some((x) => x.length > 120)) return { error: "suppliers" };
  if (kind === "prepare_order" && !ids.length) return { error: "suppliers" };
  return { value: { kind, text, time, days, supplier_ids: kind === "prepare_order" ? ids : [] } };
}

/* Due now: on, today is one of its days, its time has passed by less than RUN_WINDOW_MIN, it has not
   run today, and it was not made or changed after today's time (then it starts next time). */
export function isDue(r: Routine, now: Now, nowMs = Date.now()): boolean {
  // A one-off reminder: due once its moment has come (up to RUN_WINDOW_MIN late), and never again.
  if (r.run_at) {
    const at = Date.parse(r.run_at);
    return r.enabled && r.last_run_day == null && Number.isFinite(at) && at <= nowMs && nowMs - at < RUN_WINDOW_MIN * 60_000;
  }
  if (!r.enabled || !TIME.test(r.time) || !r.days.includes(now.weekday) || r.last_run_day === now.date) return false;
  const [h, m] = r.time.split(":").map(Number), at = h * 60 + m;
  if (now.minutes < at || now.minutes - at >= RUN_WINDOW_MIN) return false;
  const scheduled = Date.parse(`${now.date}T${r.time}:00${OFFSET}`);
  const changed = Date.parse(r.updated_at ?? r.created_at ?? "");
  return !(Number.isFinite(changed) && changed > scheduled + 60_000);
}

export type PastOrder = { weekday: number; lines: { item_id: string; supplier_id: string | null; qty: number }[] };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const round = (n: number) => Math.round(n * 1000) / 1000;

/* The usual order from one supplier for this weekday, from real past orders (newest first): the
   items in at least half of that supplier's orders on the same weekday (the last 8 of them), each at
   its usual (median) amount. Too few same-weekday orders: their last 4 orders on any day. Items that
   are gone or not available are left out. */
export function usualLines(orders: PastOrder[], supplierId: string, weekday: number, available: Set<string>) {
  const withSup = orders.filter((o) => o.lines.some((l) => l.supplier_id === supplierId && Number(l.qty) > 0));
  const same = withSup.filter((o) => o.weekday === weekday).slice(0, 8);
  const base = same.length >= 2 ? same : withSup.slice(0, 4);
  if (!base.length) return [];
  const seen = new Map<string, number[]>();
  for (const o of base) {
    const once = new Map<string, number>();
    for (const l of o.lines) if (l.supplier_id === supplierId && Number(l.qty) > 0) once.set(l.item_id, (once.get(l.item_id) ?? 0) + Number(l.qty));
    for (const [id, q] of once) (seen.get(id) ?? seen.set(id, []).get(id)!).push(q);
  }
  const need = Math.ceil(base.length / 2);
  return [...seen].filter(([id, qs]) => qs.length >= need && available.has(id))
    .map(([itemId, qs]) => ({ itemId, qty: round(median(qs)) })).filter((l) => l.qty > 0)
    .sort((a, b) => a.itemId.localeCompare(b.itemId)).slice(0, 80);
}

export type RunDeps = {
  now: Now;
  nowMs?: number;
  /* Whether this account may still use this routine (Rico on; History for prepared orders). */
  canUse: (account: string, kind: RoutineKind) => boolean;
  /* Past sent orders, newest first, and which items exist and are available, and supplier names. */
  history: () => Promise<{ orders: PastOrder[]; available: Set<string>; suppliers: Map<string, string> }>;
  /* A push to this account's signed-in phones only. */
  notify: (account: string, words: Words, tag: string) => Promise<unknown>;
};

/* Runs every routine that is due, once each. A routine is claimed (last_run_day set to today) before it
   runs, so two ticks at once never run it twice. Returns what happened, for the tick's log. */
export async function runRoutines(db: any, deps: RunDeps) {
  const { data, error } = await db.from("app_rico_routines").select("*").eq("enabled", true).limit(400);
  if (error) throw new Error("routines_unavailable");
  const nowMs = deps.nowMs ?? Date.now();
  // One-off reminders that can never come any more (already sent, or missed by more than the window,
  // or switched off) are removed, so they don't fill the list or count toward the limit.
  const stale = ((data ?? []) as Routine[]).filter((r) => r.run_at && (r.last_run_day != null || nowMs - Date.parse(r.run_at) >= RUN_WINDOW_MIN * 60_000));
  for (const r of stale) await db.from("app_rico_routines").delete().eq("id", r.id);
  const due = ((data ?? []) as Routine[]).filter((r) => !stale.includes(r) && isDue(r, deps.now, nowMs) && deps.canUse(r.account, r.kind));
  if (!due.length) return { skipped: "nothing due" };
  let pastP: ReturnType<RunDeps["history"]> | null = null;   // read once, only if a prepared order runs
  const out: unknown[] = [];
  for (const r of due) {
    const claim = await db.from("app_rico_routines").update({ last_run_day: deps.now.date })
      .eq("id", r.id).or(`last_run_day.is.null,last_run_day.neq.${deps.now.date}`).select("id");
    if (claim.error || !claim.data?.length) continue;
    // One routine failing (a write that did not go through) never stops the others.
    try { out.push(...await runOne(db, deps, r, () => (pastP ??= deps.history()))); }
    catch (e) { out.push({ id: r.id, kind: r.kind, error: String((e as Error)?.message ?? e).slice(0, 80) }); }
  }
  return out;
}

/* A name kept as one piece inside a sentence (an Arabic or Kurdish name in English text, or the other way). */
const iso = (s: string) => `\u2068${s}\u2069`;

async function runOne(db: any, deps: RunDeps, r: Routine, history: () => ReturnType<RunDeps["history"]>) {
  const out: unknown[] = [];
  {
    const key = `routine|${r.id}|${deps.now.date}`;
    if (r.kind === "remind") {
      const words = { en: `Reminder: ${r.text}`, ku: `بیرخستنەوە: ${r.text}`, ar: `تذكير: ${r.text}` };
      await inbox(db, r.account, "routine", words, key, null);
      await deps.notify(r.account, words, `ricotta-${key}`);
      // A one-off reminder is done once it has come.
      if (r.run_at) await db.from("app_rico_routines").delete().eq("id", r.id);
      out.push({ id: r.id, kind: r.kind, once: !!r.run_at });
      return out;
    }
    const past = await history();
    for (const sid of r.supplier_ids) {
      const name = (past.suppliers.get(sid) ?? "").slice(0, 60);
      if (!name) continue;   // the supplier was deleted
      const lines = usualLines(past.orders, sid, deps.now.weekday, past.available);
      const k = `${key}|${sid}`;
      if (!lines.length) {
        await inbox(db, r.account, "routine", {
          en: `${iso(name)}: no past orders to prepare today's order from.`,
          ku: `${iso(name)}: هیچ داواکارییەکی پێشوو نییە بۆ ئامادەکردنی داواکاریی ئەمڕۆ.`,
          ar: `${iso(name)}: لا توجد طلبات سابقة لتجهيز طلب اليوم.`,
        }, k, null);
        continue;
      }
      const n = lines.length;
      await inbox(db, r.account, "routine_order", {
        en: `${iso(name)}: today's order is ready to check (${n} ${n === 1 ? "item" : "items"}).`,
        ku: `${iso(name)}: داواکاریی ئەمڕۆ ئامادەیە بۆ پشکنین (${n} کاڵا).`,
        ar: `${iso(name)}: طلب اليوم جاهز للمراجعة (${n} مواد).`,
      }, k, { supplierId: sid, supplier: name, day: deps.now.date, lines });
      await deps.notify(r.account, {
        en: `${iso(name)}: today's order is ready to check.`,
        ku: `${iso(name)}: داواکاریی ئەمڕۆ ئامادەیە بۆ پشکنین.`,
        ar: `${iso(name)}: طلب اليوم جاهز للمراجعة.`,
      }, `ricotta-${k}`);
      out.push({ id: r.id, kind: r.kind, supplier: sid, lines: n });
    }
  }
  return out;
}

async function inbox(db: any, account: string, kind: string, words: Words, key: string, payload: unknown) {
  const { error } = await db.from("app_rico_inbox").upsert([{
    account, kind, mood: "calm", body_en: words.en, body_ku: words.ku, body_ar: words.ar, dedupe_key: key, ...(payload ? { payload } : {}),
  }], { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error("inbox_failed");
}

/* "Every day at 09:00", "Sun, Mon at 07:30": the time and days in plain words, for Rico's answers. */
export function whenWords(time: string, days: number[]) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.length === 7 ? `every day at ${time}` : `${days.map((d) => names[d]).join(", ")} at ${time}`;
}
