/* Run with Node 24+: node --experimental-strip-types scripts/rico-provider-smoke.mjs.
   All AI and database calls are mocked; no real key or kitchen data is used. */
import assert from 'node:assert/strict';

const secrets = new Map();
const usage = [];
const environment = new Map();
globalThis.Deno = { env: { get: (key) => environment.get(key) ?? '' } };
const { assistantStatus, setAssistantKey, handleChat } = await import('../supabase/functions/api/assistant.ts');

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

const geminiKey = 'AIza' + 'A'.repeat(35);
const claudeKey = 'sk-ant-' + 'B'.repeat(28);
const requests = [];
let geminiTurn = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes('/models?pageSize=1') || url.includes('api.anthropic.com/v1/models')) return new Response('{}');
  requests.push({ url, body: JSON.parse(options.body) });
  if (url.includes('streamGenerateContent')) {
    const payload = geminiTurn++ === 0
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'open_screen', args: { screen: 'order' } }, thoughtSignature: 'keep-this' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }
      : { candidates: [{ content: { role: 'model', parts: [{ text: 'All set.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 } };
    const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\r\n\r\n`);
    const split = encoded.length - 3; // Split the CRLF pair across network chunks.
    const body = new ReadableStream({ start(controller) { controller.enqueue(encoded.slice(0, split)); controller.enqueue(encoded.slice(split)); controller.close(); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (url.includes('api.anthropic.com/v1/messages')) {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Claude still works.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    ];
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error(`Unexpected upstream: ${url}`);
};

const session = { id: 'test-session', role: 'admin', deviceId: null };
const chat = async () => {
  const response = await handleChat(db, session, { messages: [{ role: 'user', content: 'Hello' }], lang: 'en' }, {}, new AbortController().signal);
  return (await response.text()).trim().split('\n').map(JSON.parse);
};

assert.deepEqual(await setAssistantKey(db, { key: geminiKey }), { ok: true });
assert.deepEqual(await assistantStatus(db), { configured: true, model: 'gemini-3.5-flash-lite', provider: 'gemini', source: 'app' });
const geminiEvents = await chat();
assert.deepEqual(geminiEvents.map(e => e.type), ['status', 'proposal', 'text', 'text', 'done']);
assert.equal(geminiEvents[1].proposal.kind, 'open');
assert.equal(requests[0].body.tools[0].functionDeclarations.some(t => t.name === 'open_screen'), true);
assert.match(requests[0].body.systemInstruction.parts[0].text, /You are Rico/);
assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, 'keep-this');
assert.equal(requests[1].body.contents[2].parts[0].functionResponse.id, 'call-1');
assert.equal(usage[0].model, 'gemini-3.5-flash-lite');

assert.deepEqual(await setAssistantKey(db, { key: claudeKey }), { ok: true });
assert.equal((await assistantStatus(db)).provider, 'anthropic');
assert.equal(secrets.has('gemini_api_key'), false);
assert.deepEqual((await chat()).map(e => e.type), ['text', 'done']);
assert.equal(requests.at(-1).body.model, 'claude-sonnet-5');

assert.deepEqual(await setAssistantKey(db, { remove: true }), { ok: true });
assert.equal((await assistantStatus(db)).configured, false);
environment.set('ANTHROPIC_API_KEY', claudeKey);
assert.deepEqual(await assistantStatus(db), { configured: true, model: 'claude-sonnet-5', provider: 'anthropic', source: 'secret' });
console.log('Rico provider smoke: PASS (Gemini tools and stream, Claude stream, key switching and removal)');
