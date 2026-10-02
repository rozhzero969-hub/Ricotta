// Paid restaurant expenses: exact minor units, separate currencies, and an
// immutable server-actor audit trail. Purchase orders never create expenses.
import { BodyTooLarge, InvalidBody } from "../_shared/security.ts";

type FinanceSession = { account: string };
type FinanceOptions = {
  db: any;
  session: FinanceSession;
  req: Request;
  routeSegments: string[];
  url: URL;
  json: (value: unknown, status?: number) => Response;
  fail: (message: string, status?: number) => Response;
  bodyReader: (request: Request, maxBytes?: number) => Promise<Record<string, unknown>>;
};
const CATEGORIES = ["food", "supplies", "rent", "utilities", "staff", "transport", "other"];
const CURRENCIES = ["IQD", "USD"];
const METHODS = ["cash", "card", "bank", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateValid = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const cleanText = (value: unknown, max: number, required = false): string | null => {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > max || (required && !text) ? null : text;
};
const expenseShape = (row: any) => ({
  id: row.id, date: row.paid_date, category: row.category, description: row.description,
  supplierId: row.supplier_id ?? null, supplierName: row.supplier_name ?? "", supplier: row.supplier_name ?? "",
  currency: row.currency, amountMinor: Number(row.amount_minor), paymentMethod: row.payment_method, notes: row.notes ?? "",
  status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  createdBy: row.created_by, updatedBy: row.updated_by,
  voidedAt: row.voided_at ?? null, voidedBy: row.voided_by ?? null, voidReason: row.void_reason ?? null,
});
function expensePayload(body: Record<string, unknown>) {
  const description = cleanText(body.description, 160, true);
  const supplierName = cleanText(body.supplierName ?? body.supplier, 160);
  const supplierId = body.supplierId === null || body.supplierId === undefined || body.supplierId === ""
    ? null : cleanText(body.supplierId, 160, true);
  const notes = cleanText(body.notes, 1000);
  if (!dateValid(body.date) || typeof body.category !== "string" || !CATEGORIES.includes(body.category) ||
      description === null || supplierName === null || notes === null ||
      (body.supplierId !== undefined && body.supplierId !== null && body.supplierId !== "" && supplierId === null) ||
      typeof body.currency !== "string" || !CURRENCIES.includes(body.currency) ||
      typeof body.amountMinor !== "number" || !Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0 || body.amountMinor > 1e12 ||
      typeof body.paymentMethod !== "string" || !METHODS.includes(body.paymentMethod)) return null;
  return { date: body.date, category: body.category, description, supplierId, supplierName,
    currency: body.currency, amountMinor: body.amountMinor, paymentMethod: body.paymentMethod, notes };
}
function dbFailure(error: any, fail: FinanceOptions["fail"]) {
  if (error?.code === "23505") return fail("This expense or operation ID was already used. Refresh before trying again.", 409);
  if (error?.code === "40001") return fail("This expense changed or was voided. Refresh before saving again.", 409);
  if (error?.code === "P0002") return fail("Expense not found.", 404);
  if (["22023", "23514", "22007", "22008", "22P02"].includes(error?.code)) return fail("Please check the expense fields.", 400);
  return fail("Expenses are temporarily unavailable. Your entry has not been confirmed saved.", 503);
}
const integerParam = (value: string | null, fallback: number, min: number, max: number) => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export async function handleFinance(options: FinanceOptions): Promise<Response | null> {
  const { db, session, req, routeSegments: route, url, json, fail, bodyReader } = options;
  if (route[0] !== "finance") return null;
  // This is checked again here even though the parent API authenticates first.
  if (!session || !["rozha", "yunis"].includes(session.account)) return fail("Not allowed.", 403);
  try {
    if (route.length === 1 && req.method === "GET") {
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      const category = url.searchParams.get("category"), currency = url.searchParams.get("currency");
      const status = url.searchParams.get("status") ?? "active";
      const limit = integerParam(url.searchParams.get("limit"), 50, 1, 100);
      const offset = integerParam(url.searchParams.get("offset"), 0, 0, 10000);
      if ((from !== null && !dateValid(from)) || (to !== null && !dateValid(to)) || (from && to && from > to) ||
          (category !== null && !CATEGORIES.includes(category)) || (currency !== null && !CURRENCIES.includes(currency)) ||
          !["active", "void", "all"].includes(status) || limit === null || offset === null) return fail("Invalid expense filters.", 400);
      const { data, error } = await db.rpc("app_internal_list_expenses", {
        p_from: from, p_to: to, p_category: category, p_currency: currency, p_status: status, p_limit: limit, p_offset: offset,
      });
      if (error || !data || !Array.isArray(data.expenses)) return dbFailure(error, fail);
      return json({ ...data, expenses: data.expenses.map(expenseShape) });
    }
    if (route.length >= 2 && !UUID.test(route[1])) return fail("Invalid expense ID.", 400);
    if (route.length === 2 && req.method === "GET") {
      const { data, error } = await db.from("app_expenses").select("*").eq("id", route[1]).maybeSingle();
      if (error) return dbFailure(error, fail);
      return data ? json({ expense: expenseShape(data) }) : fail("Expense not found.", 404);
    }
    if (route.length === 3 && route[2] === "events" && req.method === "GET") {
      const limit = integerParam(url.searchParams.get("limit"), 50, 1, 100);
      const offset = integerParam(url.searchParams.get("offset"), 0, 0, 10000);
      if (limit === null || offset === null) return fail("Invalid expense history filters.", 400);
      const existing = await db.from("app_expenses").select("id").eq("id", route[1]).maybeSingle();
      if (existing.error) return dbFailure(existing.error, fail);
      if (!existing.data) return fail("Expense not found.", 404);
      const { data, error, count } = await db.from("app_expense_events").select("*", { count: "exact" })
        .eq("expense_id", route[1]).order("expected_revision", { ascending: false, nullsFirst: false })
        .order("occurred_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error || !Array.isArray(data)) return dbFailure(error, fail);
      return json({ events: data.map((event: any) => ({
        id: event.id, expenseId: event.expense_id, action: event.action, actor: event.actor, at: event.occurred_at,
        expectedRevision: event.expected_revision, before: event.before_data ? expenseShape(event.before_data) : null,
        after: expenseShape(event.after_data),
      })), total: count ?? data.length, limit, offset, hasMore: (count ?? data.length) > offset + limit });
    }
    const action = route.length === 1 && req.method === "POST" ? "create"
      : route.length === 2 && req.method === "PUT" ? "edit"
      : route.length === 3 && route[2] === "void" && req.method === "POST" ? "void" : null;
    if (!action) return fail("Expense route not found.", 404);
    const body = await bodyReader(req, 16 * 1024);
    const id = action === "create" ? body.id : route[1];
    const operationId = body.operationId ?? (action === "create" ? id : undefined);
    const revision = body.expectedRevision ?? body.revision;
    if (typeof id !== "string" || !UUID.test(id) || typeof operationId !== "string" || !UUID.test(operationId) ||
        (action === "create" && revision !== undefined && revision !== null) ||
        (action !== "create" && (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1 || revision > 2147483647)) ||
        (body.expectedRevision !== undefined && body.revision !== undefined && body.expectedRevision !== body.revision)) {
      return fail("A valid expense ID, operation ID and revision are required.", 400);
    }
    const payload = action === "void" ? { reason: cleanText(body.reason, 300, true) } : expensePayload(body);
    if (!payload || (action === "void" && !("reason" in payload && payload.reason))) return fail("Please check the expense fields.", 400);
    const { data, error } = await db.rpc("app_internal_write_expense", {
      p_id: id.toLowerCase(), p_operation_id: operationId.toLowerCase(), p_actor: session.account,
      p_action: action, p_expected_revision: action === "create" ? null : revision, p_payload: payload,
    });
    if (error || !data) return dbFailure(error, fail);
    return json({ ok: true, expense: expenseShape(data) });
  } catch (error) {
    if (error instanceof BodyTooLarge) return fail("Expense request is too large.", 413);
    if (error instanceof InvalidBody) return fail("Invalid expense JSON.", 400);
    return dbFailure(error, fail);
  }
}
