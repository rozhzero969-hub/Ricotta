/* Run with Node 24+: node --experimental-strip-types scripts/rico-provider-smoke.mjs.
   All AI and database calls are mocked; no real key or kitchen data is used. */
import assert from 'node:assert/strict';

const secrets = new Map();
const usage = [];
const environment = new Map();
globalThis.Deno = { env: { get: (key) => environment.get(key) ?? '' } };
const { assistantStatus, handleChat } = await import('../supabase/functions/api/assistant.ts');

const db = {
  from(table) {
    let action = 'read', filters = [];
    const query = {
      select() { return query; },
      in(field, values) { filters.push([field, values]); return query; },
      eq(field, value) { filters.push([field, [value]]); return query; },
      gte() { return query; }, order() { return query; },
      limit() { return query; }, range() { return query; },
      maybeSingle() { return Promise.resolve({ data: null }); },
      delete() { action = 'delete'; return query; },
      upsert(row) { secrets.set(row.key, row.value); return Promise.resolve({ error: null }); },
      insert(row) { usage.push(row); return Promise.resolve({ error: null }); },
      then(resolve) {
        if (action === 'delete') {
          const keys = filters.find(([field]) => field === 'key')?.[1] ?? [];
          for (const key of keys) secrets.delete(key);
        }
        const data = table === 'app_secrets'
          ? [...secrets].filter(([key]) => !filters.length || filters.some(([field, values]) => field === 'key' && values.includes(key)))
            .map(([key, value]) => ({ key, value })) : [];
        return Promise.resolve(resolve({ data, count: 0, error: null }));
      },
    };
    return query;
  },
};

secrets.set('gemini_api_key', 'AIza' + 'A'.repeat(35));
const requests = [];
let geminiTurn = 0;
let emptyReply = false;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  requests.push({ url, body: JSON.parse(options.body) });
  if (url.includes('streamGenerateContent')) {
    const payload = emptyReply
      ? { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2048 } }
      : geminiTurn++ === 0
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'open_screen', args: { screen: 'order' } }, thoughtSignature: 'keep-this' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }
      : { candidates: [{ content: { role: 'model', parts: [{ text: 'All set.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 } };
    const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\r\n\r\n`);
    const split = encoded.length - 3; // Split the CRLF pair across network chunks.
    const body = new ReadableStream({ start(controller) { controller.enqueue(encoded.slice(0, split)); controller.enqueue(encoded.slice(split)); controller.close(); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error(`Unexpected upstream: ${url}`);
};

const session = { id: 'test-session', role: 'admin', deviceId: null };
const chat = async () => {
  const response = await handleChat(db, session, { messages: [{ role: 'user', content: 'Hello' }], lang: 'en' }, {}, new AbortController().signal);
  return (await response.text()).trim().split('\n').map(JSON.parse);
};

assert.deepEqual(await assistantStatus(db), { configured: true, model: 'gemini-3.5-flash-lite', provider: 'gemini' });
const geminiEvents = await chat();
assert.deepEqual(geminiEvents.map(e => e.type), ['status', 'proposal', 'text', 'text', 'done']);
assert.equal(geminiEvents[1].proposal.kind, 'open');
assert.equal(requests[0].body.tools[0].functionDeclarations.some(t => t.name === 'open_screen'), true);
assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
assert.match(requests[0].body.systemInstruction.parts[0].text, /You are Rico/);
assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, 'keep-this');
assert.equal(requests[1].body.contents[2].role, 'user');
assert.equal(requests[1].body.contents[2].parts[0].functionResponse.id, 'call-1');
assert.equal(usage[0].model, 'gemini-3.5-flash-lite');
const beforeQuick = requests.length;
const quick = await handleChat(db, session, { messages: [{role:'user',content:'What did we order last time?'}], lang:'en', quickAction:'last_order' }, {}, new AbortController().signal);
assert.deepEqual((await quick.text()).trim().split('\n').map(JSON.parse).map(e=>e.type), ['text','done']);
for(const quickAction of ['prepare_order','busy_days','add_item','recent_items','late_orders']){
  const response = await handleChat(db, session, { messages: [{role:'user',content:'Shortcut'}], lang:'en', quickAction }, {}, new AbortController().signal);
  assert.deepEqual((await response.text()).trim().split('\n').map(JSON.parse).map(e=>e.type), ['text','done'], quickAction);
}
assert.equal(requests.length, beforeQuick, 'quick suggestions do not call Gemini');
emptyReply = true;
assert.deepEqual((await chat()).map(e=>e.type), ['error','done'], 'empty MAX_TOKENS produces a visible failure');

console.log('Rico provider smoke: PASS (Gemini tool role, thinking level, quick answer, empty response)');
