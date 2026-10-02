// Node 24+: validate the finance HTTP contract without production credentials.
import assert from 'node:assert/strict';
import { handleFinance } from '../supabase/functions/api/finance.ts';
import { readJsonBody } from '../supabase/functions/_shared/security.ts';

const id = '7857a451-627c-42bb-a09f-258f461af412';
const operationId = '85efc4e8-7b31-477f-8fb7-29c497d28f18';
const row = { id, paid_date: '2026-10-02', category: 'food', description: 'Vegetables', supplier_id: null,
  supplier_name: 'Market', currency: 'IQD', amount_minor: '35000', payment_method: 'cash', notes: '',
  status: 'active', revision: 1, created_by: 'yunis', updated_by: 'yunis' };
const base = { id, date: '2026-10-02', category: 'food', description: 'Vegetables', supplierName: 'Market',
  amountMinor: 35000, currency: 'IQD', paymentMethod: 'cash', notes: '' };
let calls, error, result, events, single;
function reset() { calls = []; error = null; result = structuredClone(row); events = []; single = row; }
const db = {
  async rpc(name, args) { calls.push({ name, args }); return { data: result, error }; },
  from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; }, range() { return query; },
      async maybeSingle() { calls.push({ table }); return { data: single, error }; },
      then(resolve, reject) { calls.push({ table }); return Promise.resolve({ data: events, count: events.length, error }).then(resolve, reject); },
    };
    return query;
  },
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (message, status = 400) => json({ error: message }, status);
async function call(path = 'finance', body, method = 'GET', account = 'yunis', raw = false) {
  const url = new URL(`https://test.invalid/${path}`);
  return handleFinance({ db, session: { account }, req: new Request(url, {
    method, ...(body !== undefined ? { body: raw ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  }), routeSegments: url.pathname.slice(1).split('/'), url, json, fail, bodyReader: readJsonBody });
}
reset();
assert.equal(await call('suppliers'), null);
assert.equal((await call('finance', undefined, 'GET', 'intruder')).status, 403);
assert.equal(calls.length, 0, 'unknown accounts never reach the database');
for (const account of ['yunis', 'rozha']) {
  reset();
  const response = await call('finance', { ...base, actor: 'intruder', createdBy: 'intruder', description: ' Vegetables ' }, 'POST', account);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expense.amountMinor, 35000);
  assert.deepEqual(calls[0], { name: 'app_internal_write_expense', args: {
    p_id: id, p_operation_id: id, p_actor: account, p_action: 'create', p_expected_revision: null,
    p_payload: { date: base.date, category: base.category, description: 'Vegetables', supplierId: null,
      supplierName: 'Market', currency: 'IQD', amountMinor: 35000, paymentMethod: 'cash', notes: '' },
  } }, 'the authenticated account is the only actor and unknown body fields are discarded');
}
for (const invalid of [
  { amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.1 }, { amountMinor: '12' }, { amountMinor: 1000000000001 },
  { amountMinor: null }, { currency: 'EUR' }, { date: '2026-02-29' }, { date: '2026-2-01' },
  { date: '2200-01-01' }, { category: 'unknown' }, { paymentMethod: 'crypto' }, { description: ' ' },
  { description: 'x'.repeat(161) }, { notes: 'x'.repeat(1001) }, { supplierId: 99 }, { id: 'not-uuid' },
  { operationId: 'not-uuid' }, { revision: 1 },
]) {
  reset();
  assert.equal((await call('finance', { ...base, ...invalid }, 'POST')).status, 400, JSON.stringify(invalid));
  assert.equal(calls.length, 0);
}
reset();
assert.equal((await call('finance', { ...base, date: '2024-02-29', currency: 'USD', amountMinor: 1234 }, 'POST')).status, 200);
assert.equal(calls[0].args.p_payload.amountMinor, 1234, 'USD remains exact cents');
reset();
assert.equal((await call(`finance/${id}`, { ...base, expectedRevision: 1 }, 'PUT')).status, 400, 'edits require their own stable operation id');
assert.equal((await call(`finance/${id}`, { ...base, operationId, revision: 1 }, 'PUT')).status, 200);
assert.equal(calls[0].args.p_expected_revision, 1);
assert.equal(calls[0].args.p_action, 'edit');
reset();
assert.equal((await call(`finance/${id}`, { ...base, operationId, revision: 1, expectedRevision: 2 }, 'PUT')).status, 400);
assert.equal((await call(`finance/${id}/void`, { operationId, expectedRevision: 1, reason: 'Duplicate entry', actor: 'rozha' }, 'POST')).status, 200);
assert.deepEqual(calls[0].args.p_payload, { reason: 'Duplicate entry' });
assert.equal(calls[0].args.p_actor, 'yunis');
reset();
assert.equal((await call(`finance/${id}/void`, { operationId, expectedRevision: 1, reason: ' ' }, 'POST')).status, 400);
assert.equal((await call(`finance/${id}`, undefined, 'DELETE')).status, 404, 'there is no destructive delete route');
for (const [code, status] of [['23505', 409], ['40001', 409], ['P0002', 404], ['22023', 400], ['XX000', 503]]) {
  reset(); error = { code, message: 'private database detail' };
  const response = await call('finance', base, 'POST');
  assert.equal(response.status, status);
  assert.equal((await response.text()).includes('private database detail'), false);
}
for (const query of ['from=2026-02-29', 'from=2026-10-02&to=2026-10-01', 'category=bad', 'currency=EUR', 'limit=101', 'limit=0', 'offset=10001', 'offset=-1', 'status=deleted']) {
  reset();
  assert.equal((await call(`finance?${query}`)).status, 400, query);
  assert.equal(calls.length, 0);
}
reset();
result = { expenses: [row], totals: { IQD: { amountMinor: '10000000000000001', count: 10001 }, USD: { amountMinor: '1234', count: 1 } },
  total: 10002, limit: 2, offset: 10, hasMore: true, ledgerVersion: '10002' };
const listing = await (await call('finance?from=2026-10-01&to=2026-10-31&currency=IQD&category=food&limit=2&offset=10&status=all')).json();
assert.equal(listing.totals.IQD.amountMinor, '10000000000000001', 'aggregate totals are not rounded through JS Number');
assert.equal(listing.expenses[0].date, '2026-10-02');
assert.equal(listing.ledgerVersion, '10002', 'export consistency version survives the API boundary');
assert.deepEqual(calls[0].args, { p_from: '2026-10-01', p_to: '2026-10-31', p_category: 'food', p_currency: 'IQD', p_status: 'all', p_limit: 2, p_offset: 10 });
reset();
events = [{ id: operationId, expense_id: id, action: 'create', actor: 'yunis', after_data: row, before_data: null }];
assert.equal((await (await call(`finance/${id}/events`)).json()).events[0].after.amountMinor, 35000);
single = null;
assert.equal((await call(`finance/${id}/events`)).status, 404);
reset();
assert.equal((await call('finance', '{broken', 'POST', 'yunis', true)).status, 400);
assert.equal((await call('finance', JSON.stringify({ ...base, notes: 'ڕ'.repeat(9000) }), 'POST', 'yunis', true)).status, 413, 'actual UTF8 bytes bound finance requests');
assert.equal(calls.length, 0);
console.log('Finance API smoke: PASS (both accounts, exact money, actor ownership, revisions, filters, retry IDs, audit, bounded JSON)');
