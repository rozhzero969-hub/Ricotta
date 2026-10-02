// Node 24+: local request/provider mocks only; no real keys or database.
import assert from 'node:assert/strict';
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from '../supabase/functions/_shared/security.ts';
import { handleChat, handleTranscribe, _internals } from '../supabase/functions/api/assistant.ts';

globalThis.Deno = { env: { get: () => '' } };
const request = body => new Request('https://example.test', { method: 'POST', body });
assert.deepEqual(await readJsonBody(request('{"name":"ڕۆژا"}')), { name: 'ڕۆژا' });
for (const body of ['null', 'true', '1', '[]', '"text"', '{broken']) {
  await assert.rejects(readJsonBody(request(body)), InvalidBody, `reject ${body}`);
}
await assert.rejects(readJsonBody(request(JSON.stringify({ value: 'ڕ'.repeat(20) })), 40), BodyTooLarge, 'limits count UTF-8 bytes');
let cancelled = false;
const stream = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(65)); },
  cancel() { cancelled = true; },
});
await assert.rejects(readJsonBody(new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' }), 64), BodyTooLarge);
assert.equal(cancelled, true, 'oversized chunked uploads are cancelled before buffering the rest');
for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/Qabc', 'https://wns2-test.notify.windows.com/w/?token=abc']) assert.equal(isPushEndpoint(endpoint), true, endpoint);
for (const endpoint of ['https://localhost/internal', 'https://127.0.0.1/', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.attacker.test/x', 'https://attacker.test/?fcm.googleapis.com', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 'https://fcm.googleapis.com/x#fragment']) assert.equal(isPushEndpoint(endpoint), false, endpoint);

let quota = 1, quotaError = null, providerCalls = 0, key = 'fake-test-key', dataError = false;
const reservations = [], completed = [];
const db = {
  rpc(name, args) {
    assert.equal(name, 'app_internal_reserve_assistant');
    reservations.push(args);
    return Promise.resolve({ data: quota, error: quotaError });
  },
  from(table) {
    let change;
    const q = {
      select() { return q; }, in() { return q; }, eq() { return q; }, gte() { return q; }, neq() { return q; },
      order() { return q; }, limit() { return q; }, range() { return q; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      update(row) { assert.equal(table, 'app_assistant_usage'); change = row; return q; },
      then(resolve, reject) {
        if (change) completed.push(change);
        return Promise.resolve({ data: table === 'app_secrets' ? (key ? [{ key: 'gemini_api_key', value: key }] : []) : [],
          error: dataError && table === 'app_items' ? { message: 'offline' } : null }).then(resolve, reject);
      },
    };
    return q;
  },
};
globalThis.fetch = async (url) => {
  providerCalls++;
  assert.ok(reservations.length, 'a quota slot exists before any provider call');
  if (String(url).includes(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: 'five boxes' }] } }] });
  return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '[[mood:happy]] Ready.' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } })}\n\n`);
};
const session = { id: 'session-1', account: 'yunis', deviceId: null };
const body = { messages: [{ role: 'user', content: 'Hello' }], lang: 'en' };
const chat = () => handleChat(db, session, body, {}, new AbortController().signal);
quota = null;
assert.equal((await chat()).status, 429);
assert.equal(providerCalls, 0, 'exhausted quota cannot call AI');
quotaError = { message: 'offline' };
assert.equal((await chat()).status, 503);
assert.equal(providerCalls, 0, 'quota failures fail closed');
quota = 42; quotaError = null;
const response = await chat();
assert.match(await response.text(), /Ready/);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(providerCalls, 1);
assert.equal(reservations.at(-1).p_device_id, '__session:session-1', 'missing device IDs still have a quota identity');
assert.equal(completed.at(-1).input_tokens, 7);

const audio = { audio: Buffer.alloc(900, 1).toString('base64'), mime: 'audio/webm', lang: 'en' };
quota = null;
assert.equal((await handleTranscribe(db, session, audio, {})).status, 429);
assert.equal(providerCalls, 1, 'transcription shares the reply quota');
key = '';
const beforeQuick = reservations.length;
const quick = await handleChat(db, session, { ...body, quickAction: 'last_order' }, {}, new AbortController().signal);
assert.match(await quick.text(), /"done"/);
assert.equal(reservations.length, beforeQuick, 'free local quick actions need no provider key or AI quota');
dataError = true;
await assert.rejects(handleChat(db, session, { ...body, quickAction: 'last_order' }, {}, new AbortController().signal), /kitchen_data_unavailable/, 'database errors never masquerade as an empty kitchen');

const proposals = [];
const world = { items: [{ id: 'tomato', name: 'Tomatoes' }], pars: [{ item_id: 'tomato', par_qty: 10, busy_boost_pct: 50, est_qty: 2 }] };
const result = _internals.proposeStockCount(world, { item_id: 'tomato', qty: 5 }, event => proposals.push(event));
assert.equal(result.shown, true);
assert.deepEqual({ ...proposals[0].proposal, id: undefined }, { id: undefined, kind: 'stock_count', itemId: 'tomato', name: 'Tomatoes', qty: 5, parQty: 10, busyBoostPct: 50, beforeQty: 2 });
assert.match(_internals.proposeStockCount(world, { item_id: 'tomato', qty: Infinity }, () => assert.fail()).error, /quantity/);
console.log('Backend security smoke: PASS (bounded UTF-8 bodies, push SSRF checks, fail-closed AI quotas, free quick actions, stock confirmation)');
