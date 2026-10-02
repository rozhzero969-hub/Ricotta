// Only use the disposable SQL test database, with PG* variables (CI) or
// DB_SMOKE_CONTAINER + PGDATABASE (local). Fixtures are removed afterwards.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function sql(query) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', query];
  const command = process.env.DB_SMOKE_CONTAINER ? 'docker' : 'psql';
  const commandArgs = process.env.DB_SMOKE_CONTAINER
    ? ['exec', '-e', 'PGUSER=postgres', '-e', `PGDATABASE=${process.env.PGDATABASE || 'postgres'}`, process.env.DB_SMOKE_CONTAINER, 'psql', ...args] : args;
  return (await exec(command, commandArgs, { maxBuffer: 1024 * 1024 })).stdout.trim();
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const fixtureIds = [crypto.randomUUID(), ...Array.from({ length: 12 }, () => crypto.randomUUID())];
const [id] = fixtureIds;
const initial = { date: '2026-10-02', category: 'food', description: 'Parallel paid-expense fixture', supplierId: null,
  supplierName: '', amountMinor: 1000, currency: 'IQD', paymentMethod: 'cash', notes: '' };
const write = (expenseId, operationId, action, revision, payload, actor = 'yunis') => sql(
  `select public.app_internal_write_expense(${literal(expenseId)}::uuid,${literal(operationId)}::uuid,${literal(actor)},${literal(action)},${revision ?? 'null'},${literal(JSON.stringify(payload))}::jsonb)`
).then(JSON.parse);
const contenders = 12;
try {
  const creation = await Promise.all(Array.from({ length: contenders }, () => write(id, id, 'create', null, initial)));
  assert.equal(new Set(creation.map(JSON.stringify)).size, 1, 'all create retries return the exact original snapshot');
  assert.equal(await sql(`select count(*) from app_expenses where id=${literal(id)}`), '1');
  assert.equal(await sql(`select count(*) from app_expense_events where expense_id=${literal(id)}`), '1');

  const editOperation = crypto.randomUUID();
  const editPayload = { ...initial, amountMinor: 2000 };
  const editRetry = await Promise.all(Array.from({ length: contenders }, () => write(id, editOperation, 'edit', 1, editPayload, 'rozha')));
  assert.equal(new Set(editRetry.map(JSON.stringify)).size, 1, 'parallel edit retries update once and share a result');
  assert.equal(editRetry[0].revision, 2);
  assert.equal(await sql(`select count(*) from app_expense_events where expense_id=${literal(id)}`), '2');

  const competitors = Array.from({ length: contenders }, (_, index) => ({ operation: crypto.randomUUID(), payload: { ...initial, amountMinor: 3000 + index } }));
  const competingEdits = await Promise.allSettled(competitors.map(({ operation, payload }) => write(id, operation, 'edit', 2, payload)));
  const winnerIndex = competingEdits.findIndex(result => result.status === 'fulfilled');
  assert.equal(competingEdits.filter(result => result.status === 'fulfilled').length, 1, 'one concurrent edit with the expected revision wins');
  for (const result of competingEdits.filter(result => result.status === 'rejected')) assert.match(result.reason.stderr, /40001/, 'losing edits report a revision conflict');
  const winner = competitors[winnerIndex];
  const winnerResult = competingEdits[winnerIndex].value;
  assert.equal(winnerResult.revision, 3);
  assert.deepEqual(await write(id, winner.operation, 'edit', 2, winner.payload), winnerResult, 'winning edit remains retryable after its revision advanced');
  assert.equal(await sql(`select count(*) from app_expense_events where expense_id=${literal(id)}`), '3');

  const voidOperation = crypto.randomUUID();
  const voidResults = await Promise.all(Array.from({ length: contenders }, () => write(id, voidOperation, 'void', 3, { reason: 'Disposable parallel test' }, 'rozha')));
  assert.equal(new Set(voidResults.map(JSON.stringify)).size, 1);
  assert.equal(voidResults[0].revision, 4);
  assert.equal(voidResults[0].status, 'void');
  assert.equal(await sql(`select count(*) from app_expense_events where expense_id=${literal(id)}`), '4', 'void retries add one immutable audit event');
  assert.equal(await sql(`select string_agg(action,',' order by expected_revision nulls first) from app_expense_events where expense_id=${literal(id)}`), 'create,edit,edit,void');

  // A global operation collision races DIFFERENT expense locks. The unique
  // audit key must still roll the losing creation back with no orphaned row.
  const sharedOperation = crypto.randomUUID();
  const collision = await Promise.allSettled(fixtureIds.slice(1).map(expenseId => write(expenseId, sharedOperation, 'create', null, initial)));
  assert.equal(collision.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of collision.filter(result => result.status === 'rejected')) assert.match(result.reason.stderr, /23505/);
  const idList = fixtureIds.slice(1).map(literal).join(',');
  assert.equal(await sql(`select count(*) from app_expenses where id in (${idList})`), '1', 'operation collision cannot leave unaudited expense rows');
  assert.equal(await sql(`select count(*) from app_expense_events where id=${literal(sharedOperation)}`), '1');
  console.log('Finance concurrency smoke: PASS (12 competing creates, edit retries, revision edits, voids, and cross-expense operation collisions)');
} finally {
  const idList = fixtureIds.map(literal).join(',');
  await sql(`delete from app_expense_events where expense_id in (${idList}); delete from app_expenses where id in (${idList});`);
}
