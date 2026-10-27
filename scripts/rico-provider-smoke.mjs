/* Run with Node 24+: node --experimental-strip-types scripts/rico-provider-smoke.mjs.
   All AI and database calls are mocked; no real key or kitchen data is used. */
import assert from 'node:assert/strict';

const secrets = new Map();
const usage = [];
const environment = new Map();
globalThis.Deno = { env: { get: (key) => environment.get(key) ?? '' } };
const aiStatus = new Map();
const ricoOrders = [];
let kitchen = null; // set for the WhatsApp tests: { app_suppliers: [...], ... }
const { adminAi, assistantSetupStatus, assistantStatus, handleChat, handleTranscribe, removeAiKey, saveAiKey, saveGroqKey, _internals } = await import('../supabase/functions/api/assistant.ts');

const db = {
  rpc(name, args) {
    assert.equal(name, 'app_internal_reserve_assistant');
    const id = usage.length + 1;
    usage.push({ id, device_id: args.p_device_id, account: args.p_account, model: args.p_model, input_tokens: 0, output_tokens: 0 });
    return Promise.resolve({ data: id, error: null });
  },
  from(table) {
    let action = 'read', filters = [], change;
    const query = {
      select() { return query; },
      in(field, values) { filters.push([field, values]); return query; },
      eq(field, value) { filters.push([field, [value]]); return query; },
      gte() { return query; }, order() { return query; },
      limit() { return query; }, range() { return query; },
      maybeSingle() { return Promise.resolve({ data: null }); },
      delete() { action = 'delete'; return query; },
      update(row) { action = 'update'; change = row; return query; },
      upsert(row) { if (table === 'app_ai_status') aiStatus.set(row.provider, row); else secrets.set(row.key, row.value); return Promise.resolve({ error: null }); },
      insert(row) {
        if (table === 'app_secrets') {
          if (secrets.has(row.key)) return Promise.resolve({ error: { code: '23505' } });
          secrets.set(row.key, row.value);
        } else if (table === 'app_rico_orders') ricoOrders.push(row);
        else usage.push(row);
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        if (action === 'update' && table === 'app_assistant_usage') {
          const id = filters.find(([field]) => field === 'id')?.[1]?.[0];
          Object.assign(usage.find(row => row.id === id), change);
        }
        if (action === 'delete') {
          const keys = filters.find(([field]) => field === 'key')?.[1] ?? [];
          for (const key of keys) secrets.delete(key);
        }
        const data = table === 'app_secrets'
          ? [...secrets].filter(([key]) => !filters.length || filters.some(([field, values]) => field === 'key' && values.includes(key)))
            .map(([key, value]) => ({ key, value }))
          : table === 'app_ai_status' ? [...aiStatus.values()]
          : table === 'app_assistant_usage' ? usage
          : kitchen?.[table] ?? [];
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
let groqTurn = 0;
let groqUnavailable = false;
let groqReply = null;
let groqTool = 'open_screen';
let groqSecondTurnDown = false;
let strongModelMissing = false;
let strongModelSlow = false;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  requests.push({ url, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
  if (url.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'تەماتە پێنج کیلۆ' }] } }] }), { headers: { 'content-type': 'application/json' } });
  if (url.includes('audio/transcriptions')) return new Response(JSON.stringify({ text: 'five boxes of tomatoes' }), { headers: { 'content-type': 'application/json' } });
  if (url.includes('streamGenerateContent')) {
    if (strongModelMissing && url.includes('/gemini-3.5-flash:')) return new Response('{"error":{"code":404}}', { status: 404 });
    if (strongModelSlow && url.includes('/gemini-3.5-flash:')) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const payload = emptyReply
      ? { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2048 } }
      : geminiTurn++ === 0
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'open_screen', args: { screen: 'order' } }, thoughtSignature: 'keep-this' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }
      : { candidates: [{ content: { role: 'model', parts: [{ text: '[[mood:happy]] All set.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 } };
    const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\r\n\r\n`);
    const split = encoded.length - 3; // Split the CRLF pair across network chunks.
    const body = new ReadableStream({ start(controller) { controller.enqueue(encoded.slice(0, split)); controller.enqueue(encoded.slice(split)); controller.close(); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (new URL(url).hostname === 'api.anthropic.com') return anthropic(url, options);
  if (new URL(url).hostname === 'graph.facebook.com') {
    whatsappCalls.push({ url, auth: options.headers.authorization, body: JSON.parse(options.body) });
    return whatsappWindowClosed
      ? new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 })
      : new Response(JSON.stringify({ messages: [{ id: 'wamid.test' + whatsappCalls.length }] }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('api.groq.com/openai/v1/chat/completions')) {
    if (groqUnavailable) return new Response('{"error":{"message":"busy"}}', { status: 503 });
    if (groqSecondTurnDown && groqTurn === 1) { groqTurn++; return new Response('{"error":{"message":"busy"}}', { status: 503 }); }
    const payload = groqReply ? groqReply.map(content => ({ choices: [{ delta: { content } }] }))
      : groqTurn++ === 0
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'groq-call-1', type: 'function', function: { name: groqTool, arguments: '{"screen":"order"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }
      : [{ choices: [{ delta: { content: '[[mood:exc' } }] }, { choices: [{ delta: { content: 'ited]] Groq is ready.' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }];
    const events = (Array.isArray(payload) ? payload : [payload]).map(p => `data: ${JSON.stringify(p)}\n\n`).join('');
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`${events}data: [DONE]\n\n`)); controller.close(); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error(`Unexpected upstream: ${url}`);
};


// Claude Haiku: a tool call first (with a thinking block that must go back unchanged), then the answer.
let anthropicTurn = 0;
const whatsappCalls = [];
let whatsappWindowClosed = false;
let anthropicFail = null; // { status, type, message } or 'slow'
let anthropicTool = { name: 'open_screen', json: ['{"screen":', '"order"}'] };
const anthropicKey = 'sk-ant-api03-' + 'C'.repeat(40), adminKey = 'sk-ant-admin01-' + 'D'.repeat(40);
const sse = events => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))); controller.close();
} }), { headers: { 'content-type': 'text/event-stream' } });
async function anthropic(url, options) {
  const key = options.headers['x-api-key'];
  if (url.includes('/models?')) return new Response(key === anthropicKey ? '{"data":[]}' : '{}', { status: key === anthropicKey ? 200 : 401 });
  if (url.includes('/organizations/cost_report')) {
    if (key !== adminKey) return new Response('{}', { status: key === anthropicKey ? 403 : 401 });
    return new Response(JSON.stringify({ data: [{ results: [{ amount: '1.25', currency: 'USD' }] }, { results: [{ amount: '2.5', currency: 'USD' }] }], has_more: false }), { headers: { 'content-type': 'application/json' } });
  }
  if (anthropicFail === 'slow') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  if (anthropicFail) return new Response(JSON.stringify({ type: 'error', error: { type: anthropicFail.type, message: anthropicFail.message ?? '' } }), { status: anthropicFail.status });
  if (anthropicTurn++ === 0) return sse([
    { type: 'message_start', message: { usage: { input_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Open the order.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: anthropicTool.name, input: {} } },
    ...anthropicTool.json.map(partial_json => ({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' }]);
  return sse([
    { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '[[mood:happy]] Haiku ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'is here.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
    { type: 'message_stop' }]);
}

const session = { id: 'test-session', account: 'rozha', deviceId: null };
const chat = async (content = 'Hello', lang = 'en') => {
  const response = await handleChat(db, session, { messages: [{ role: 'user', content }], lang }, {}, new AbortController().signal);
  return (await response.text()).trim().split('\n').map(JSON.parse);
};

assert.deepEqual(await assistantStatus(db), { configured: true, model: 'gemini-3.5-flash-lite', provider: 'gemini', fallback: false });
const geminiEvents = await chat();
assert.deepEqual(geminiEvents.map(e => e.type), ['status', 'proposal', 'text', 'mood', 'text', 'done']);
assert.equal(geminiEvents[3].mood, 'happy');
assert.equal(geminiEvents.filter(e => e.type === 'text').map(e => e.text).join(''), '\n\nAll set.', 'the mood tag never reaches the text');
assert.equal(geminiEvents[1].proposal.kind, 'open');
assert.equal(requests[0].body.tools[0].functionDeclarations.some(t => t.name === 'open_screen'), true);
assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
assert.match(requests[0].body.systemInstruction.parts[0].text, /You are Rico/);
assert.match(requests[0].body.systemInstruction.parts[0].text, /Talking to: Rozha/);
assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature, 'keep-this');
assert.equal(requests[1].body.contents[2].role, 'user');
assert.equal(requests[1].body.contents[2].parts[0].functionResponse.id, 'call-1');
assert.equal(usage[0].model, 'gemini-3.5-flash-lite');
const beforeQuick = requests.length;
const quick = await handleChat(db, session, { messages: [{role:'user',content:'What did we order last time?'}], lang:'en', quickAction:'last_order' }, {}, new AbortController().signal);
assert.deepEqual((await quick.text()).trim().split('\n').map(JSON.parse).map(e=>e.type), ['mood','text','done']);
for(const quickAction of ['prepare_order','add_item','late_orders','check_order','week_insights']){
  const response = await handleChat(db, session, { messages: [{role:'user',content:'Shortcut'}], lang:'en', quickAction }, {}, new AbortController().signal);
  assert.deepEqual((await response.text()).trim().split('\n').map(JSON.parse).map(e=>e.type), ['mood','text','done'], quickAction);
}
assert.equal(requests.length, beforeQuick, 'quick suggestions do not call Gemini');
emptyReply = true;
assert.deepEqual((await chat()).map(e=>e.type), ['error','done'], 'empty MAX_TOKENS produces a visible failure');
emptyReply = false;
assert.deepEqual(await saveGroqKey(db, 'gsk_' + 'B'.repeat(30)), { ok: true });
assert.deepEqual(await assistantSetupStatus(db), { groqConfigured: true });
assert.deepEqual(await assistantStatus(db), { configured: true, model: 'openai/gpt-oss-120b', provider: 'groq', fallback: true });
const beforeGroq = requests.length;
const groqEvents = await chat();
assert.deepEqual(groqEvents.map(e => e.type), ['status', 'proposal', 'mood', 'text', 'done'], 'a mood tag split across chunks is still found');
assert.equal(groqEvents[2].mood, 'excited');
assert.equal(groqEvents[3].text, 'Groq is ready.');
assert.equal(new URL(requests[beforeGroq].url).hostname, 'api.groq.com');
assert.equal(requests[beforeGroq].body.model, 'openai/gpt-oss-120b');
assert.equal(requests[beforeGroq].body.reasoning_effort, 'low');
assert.equal(requests[beforeGroq].body.parallel_tool_calls, false);
assert.equal(requests[beforeGroq + 1].body.messages.at(-1).role, 'tool');
assert.equal(requests[beforeGroq + 1].body.messages.at(-1).tool_call_id, 'groq-call-1');
assert.equal(usage.at(-1).model, 'openai/gpt-oss-120b');
assert.equal(usage.at(-1).input_tokens, 30, 'token use includes both Groq tool rounds');
assert.equal(usage.at(-1).output_tokens, 7);
groqReply = ['[hap', 'py] Hi ', '[[calm]] there, [1] box'];
const strayEvents = await chat();
assert.deepEqual(strayEvents.filter(e => e.type === 'mood').map(e => e.mood), ['happy', 'calm'], 'moods in other shapes are still read');
assert.equal(strayEvents.filter(e => e.type === 'text').map(e => e.text).join(''), 'Hi there, [1] box', 'no mood word is shown as text');
groqReply = null;
strongModelMissing = true; geminiTurn = 1;
const beforeKurdish = requests.length;
const kurdishEvents = await chat('سڵاو ریکۆ', 'en');
assert.equal(kurdishEvents.find(e => e.type === 'mood')?.mood, 'happy');
assert.deepEqual(requests.slice(beforeKurdish).map(r => r.url.match(/models\/([^:]+)/)?.[1] ?? 'groq'), ['gemini-3.5-flash', 'gemini-3.5-flash-lite'], 'Kurdish goes to Gemini first, and to flash-lite if the stronger model is missing');
assert.match(requests.at(-1).body.systemInstruction.parts[0].text, /KURDISH \(SORANI\)/);
strongModelMissing = false; geminiTurn = 1;
const beforeKu = requests.length;
await chat('hello', 'ku');
assert.equal(requests[beforeKu].url.includes('/gemini-3.5-flash:'), true, 'the Kurdish app language also uses the stronger Gemini model');
strongModelSlow = true; geminiTurn = 1;
const slowStart = Date.now();
const slowEvents = await chat('سڵاو', 'ku');
assert.equal(slowEvents.find(e => e.type === 'mood')?.mood, 'happy', 'a busy stronger model hands over to flash-lite');
assert.ok(Date.now() - slowStart < 15000);
assert.equal(requests.at(-1).url.includes('gemini-3.5-flash-lite'), true);
strongModelSlow = false;
groqUnavailable = true; geminiTurn = 0;
const fallbackEvents = await chat();
assert.equal(fallbackEvents.at(-1).type, 'done');
assert.equal(requests.at(-1).url.includes('streamGenerateContent'), true, 'Gemini is used after Groq rejects a request');
groqUnavailable = false; groqSecondTurnDown = true;
groqTurn = 0; const beforeHalfway = requests.length;
const halfwayEvents = await chat();
assert.deepEqual(halfwayEvents.map(e => e.type), ['status', 'proposal', 'error', 'done'], 'a card already shown is never repeated by another model');
assert.equal(halfwayEvents[2].code, 'busy');
assert.equal(requests.slice(beforeHalfway).some(r => r.url.includes('streamGenerateContent')), false, 'no second model starts the reply again');
groqTurn = 0; groqTool = 'list_suppliers'; geminiTurn = 1; const beforeLookup = requests.length;
const lookupEvents = await chat();
assert.deepEqual(lookupEvents.map(e => e.type), ['status', 'mood', 'text', 'done'], 'after a lookup with nothing on screen, Gemini still answers');
assert.equal(requests.slice(beforeLookup).some(r => r.url.includes('streamGenerateContent')), true);
groqSecondTurnDown = false; groqTool = 'open_screen';

// Claude Haiku 5.5 answers first once its key is saved; the free AIs take over when it can't.
assert.deepEqual(await saveAiKey(db, 'anthropic', 'sk-ant-api03-short'), { ok: false, error: 'invalid_key' });
assert.deepEqual(await saveAiKey(db, 'anthropic', 'sk-ant-api03-' + 'E'.repeat(40)), { ok: false, error: 'invalid_key' }, 'a key Anthropic rejects is not saved');
assert.equal(secrets.has('anthropic_api_key'), false);
assert.deepEqual(await saveAiKey(db, 'openai', anthropicKey), { ok: false, error: 'invalid_input' });
assert.deepEqual(await saveAiKey(db, 'anthropic', anthropicKey), { ok: true });
assert.equal(secrets.get('anthropic_api_key'), anthropicKey);
assert.equal((await assistantStatus(db)).provider, 'anthropic');
const beforeHaiku = requests.length;
const haikuEvents = await chat();
assert.deepEqual(haikuEvents.map(e => e.type), ['status', 'proposal', 'text', 'mood', 'text', 'text', 'done']);
assert.equal(haikuEvents.filter(e => e.type === 'text').map(e => e.text).join(''), '\n\nHaiku is here.');
const haikuCalls = requests.slice(beforeHaiku);
assert.equal(haikuCalls.length, 2, 'Haiku did the tool round itself; no other AI was asked');
assert.equal(haikuCalls[0].body.model, 'claude-haiku-5-5');
assert.equal(haikuCalls[0].body.output_config.effort, 'low');
assert.equal('temperature' in haikuCalls[0].body, false);
assert.deepEqual(haikuCalls[0].body.system[0].cache_control, { type: 'ephemeral' }, 'Rico\'s manual is cached');
assert.match(haikuCalls[0].body.system[0].text, /You are Rico/);
assert.equal(haikuCalls[0].body.tools.some(t => t.name === 'open_screen' && t.input_schema), true);
const turnBack = haikuCalls[1].body.messages;
assert.deepEqual(turnBack.at(-2).content[0], { type: 'thinking', thinking: 'Open the order.', signature: 'sig-1' }, 'thinking goes back unchanged');
assert.deepEqual(turnBack.at(-2).content[1].input, { screen: 'order' });
assert.equal(turnBack.at(-1).content[0].type, 'tool_result');
assert.equal(turnBack.at(-1).content[0].tool_use_id, 'toolu_1');
assert.equal(usage.at(-1).model, 'claude-haiku-5-5');
assert.equal(usage.at(-1).input_tokens, 232, 'cached input is counted too');
assert.equal(usage.at(-1).output_tokens, 15);
assert.equal(aiStatus.get('anthropic').state, 'working');
for (const [fail, state] of [[{ status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }, 'no_funds'],
  [{ status: 401, type: 'authentication_error' }, 'key_rejected'], [{ status: 529, type: 'overloaded_error' }, 'busy'], ['slow', 'busy']]) {
  anthropicFail = fail; geminiTurn = 1; groqTurn = 1;
  const started = Date.now(), before = requests.length;
  const events = await chat();
  assert.equal(events.find(e => e.type === 'text')?.text !== undefined, true, `${state}: a backup still answers`);
  assert.equal(events.some(e => e.type === 'error'), false);
  assert.equal(requests.slice(before).some(r => new URL(r.url).hostname !== 'api.anthropic.com'), true);
  assert.equal(aiStatus.get('anthropic').state, state);
  assert.ok(Date.now() - started < 15000);
}
anthropicFail = null; anthropicTurn = 0;
let ai = await adminAi(db);
assert.deepEqual(ai.brains.map(b => [b.id, b.connected]), [['anthropic', true], ['gemini', true], ['groq', true]]);
assert.equal(ai.brains[0].calls >= 1 && ai.brains[0].input >= 232, true);
assert.deepEqual(ai.brains[0].bill, { error: 'no_admin_key' }, 'no bill is guessed without the admin key');
assert.deepEqual(ai.brains[1].bill, { free: true });
assert.equal(ai.adminKey, false);
assert.deepEqual(await saveAiKey(db, 'anthropic_admin', 'sk-ant-admin01-' + 'F'.repeat(40)), { ok: false, error: 'invalid_key' });
assert.deepEqual(await saveAiKey(db, 'anthropic_admin', adminKey), { ok: true });
ai = await adminAi(db);
assert.equal(ai.adminKey, true);
assert.equal(ai.brains[0].bill.usd, 0.0375, 'the bill is Anthropic\'s own cost report (cents to dollars)');
assert.equal(JSON.stringify(ai).includes('sk-ant'), false, 'keys never go back to the app');

// Rico orders by himself (TEST): usual amounts plus the ones Rozha named, sent by WhatsApp only to her number.
const ago = m => new Date(Date.now() - m * 60000).toISOString();
kitchen = {
  app_suppliers: [{ id: 'sup-bakery', name: 'Bakery', phone: '', reminder: null }, { id: 'sup-veg', name: 'Vegetables', phone: '', reminder: null }],
  app_units: [{ id: 'u-piece', en: 'piece' }, { id: 'u-kg', en: 'kg' }],
  app_items: [{ id: 'it-burger', name: 'Burger bread', unit_id: 'u-piece', supplier_id: 'sup-bakery', available: true },
    { id: 'it-toast', name: 'Toast bread', unit_id: 'u-piece', supplier_id: 'sup-bakery', available: true },
    { id: 'it-tomato', name: 'Tomato', unit_id: 'u-kg', supplier_id: 'sup-veg', available: true }],
  app_orders: [1, 2, 3].map(k => ({ id: 'o' + k, sent_at: ago(k), created_at: ago(k), sent_by: 'rozha' })),
  app_order_lines: [1, 2, 3].map(k => ({ order_id: 'o' + k, supplier_id: 'sup-bakery', supplier_name: 'Bakery', item_id: 'it-burger', item_name: 'Burger bread', unit_id: 'u-piece', qty: 24 })),
};
const orderTool = input => { anthropicTurn = 0; anthropicTool = { name: 'send_test_order', json: [JSON.stringify(input)] }; };
orderTool({ suppliers: ['Bakery'], items: [{ item_id: 'it-toast', qty: 2 }], language: 'en' });
await chat('Rico, order from the bakery, and 2 toast bread');
assert.equal(whatsappCalls.length, 0, 'nothing is sent before WhatsApp is set up');
assert.equal(ricoOrders.length, 0);
environment.set('WHATSAPP_TOKEN', 'EAA' + 'T'.repeat(40)); environment.set('WHATSAPP_PHONE_ID', '1370871979449071'); environment.set('WHATSAPP_TEST_TO', '+964 750 000 0000');
orderTool({ suppliers: ['Bakery'], items: [{ item_id: 'it-toast', qty: 2 }], language: 'en' });
const sentEvents = await chat('Rico, order from the bakery, and 2 toast bread');
assert.equal(sentEvents.some(e => e.type === 'status' && e.tool === 'send_test_order'), true);
assert.equal(whatsappCalls.length, 1);
assert.equal(whatsappCalls[0].url, 'https://graph.facebook.com/v26.0/1370871979449071/messages');
assert.equal(whatsappCalls[0].auth, 'Bearer EAA' + 'T'.repeat(40));
assert.equal(whatsappCalls[0].body.to, '9647500000000', 'only Rozha\'s own number, digits only');
assert.equal(whatsappCalls[0].body.type, 'text');
assert.equal(whatsappCalls[0].body.text.body, '[TEST] Bakery\nNew order from Ricotta:\n• Burger bread: 24 piece\n• Toast bread: 2 piece', 'usual amounts plus the named one');
assert.equal(ricoOrders.length, 1);
assert.equal(ricoOrders[0].status, 'sent');
assert.equal(ricoOrders[0].message_id, 'wamid.test1');
assert.match(ricoOrders[0].reason, /usual amounts .*based on the last 3 orders.*with the amounts Rozha named/);
const toolResult = JSON.parse(requests.filter(r => r.url.includes('anthropic.com/v1/messages')).at(-1).body.messages.at(-1).content[0].content);
assert.deepEqual(toolResult.results[0].lines, ['Burger bread: 24 piece', 'Toast bread: 2 piece']);
assert.match(toolResult.note, /only to Rozha's own WhatsApp/);
whatsappWindowClosed = true;
orderTool({ suppliers: ['Vegetables', 'Bakery'], items: [{ item_id: 'it-tomato', qty: 5 }, { item_id: 'it-burger', qty: 0 }] });
await chat('Rico, send tomatoes 5 and the bakery order yourself');
assert.equal(whatsappCalls.length, 2, 'a closed WhatsApp window stops the rest');
assert.equal(whatsappCalls[1].body.text.body, '[TEST] Vegetables\nNew order from Ricotta:\n• Tomato: 5 kg');
assert.deepEqual([ricoOrders[1].status, ricoOrders[1].error, ricoOrders[1].reason], ['failed', 'window_closed', 'the amounts Rozha named']);
whatsappWindowClosed = false;
orderTool({ suppliers: ['Bakery'] });
const yunisChat = await handleChat(db, { id: 'y', account: 'yunis', deviceId: null }, { messages: [{ role: 'user', content: 'order bakery' }], lang: 'en' }, {}, new AbortController().signal);
await yunisChat.text();
assert.equal(whatsappCalls.length, 2, 'Yunis cannot make Rico send');
kitchen = null; anthropicTool = { name: 'open_screen', json: ['{"screen":', '"order"}'] }; anthropicTurn = 0;
assert.deepEqual(await removeAiKey(db, 'anthropic'), { ok: true });
assert.equal(secrets.has('anthropic_api_key'), false);
assert.equal((await assistantStatus(db)).provider === 'anthropic', false);

console.log('Rico provider smoke: PASS (Rico sends test orders by WhatsApp to Rozha only; Claude Haiku first with tool calls, thinking and caching; free AIs take over on no credit, rejected key, busy or slow; Admin AI bill from the cost report; Gemini, Groq tool calls, Groq-to-Gemini fallback (never twice), moods (any tag shape), Kurdish to Gemini, quick answers, draft check, insights, empty response)');
