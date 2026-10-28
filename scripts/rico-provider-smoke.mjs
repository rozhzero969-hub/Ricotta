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
let reserveFails = false;
const { adminAi, handleChat, handleTranscribe, _internals } = await import('../supabase/functions/api/assistant.ts');

const db = {
  rpc(name, args) {
    // The send reservation, as the database does it: same order within 15 minutes = the earlier result;
    // the hour's messages are counted before this one is written down as pending.
    if (name === 'app_internal_rico_send_reserve') {
      if (reserveFails) return Promise.resolve({ data: null, error: { message: 'offline' } });
      const dup = ricoOrders.findLast(r => r.idem_key === args.p_key && r.status !== 'failed' && Date.now() - r.at < 15 * 60000);
      if (dup) return Promise.resolve({ data: { duplicate: true, id: dup.id, status: dup.status, at: new Date(dup.at).toISOString() }, error: null });
      const used = ricoOrders.filter(r => Date.now() - r.at < 3600000).reduce((n, r) => n + (r.status === 'pending' ? r.parts : r.status === 'failed' ? 0 : Math.max(r.sent_parts, 1)), 0);
      if (used + args.p_parts > args.p_limit) return Promise.resolve({ data: { limited: true, used }, error: null });
      const row = { id: ricoOrders.length + 1, at: Date.now(), account: args.p_account, supplier_id: args.p_supplier_id, supplier_name: args.p_supplier_name,
        lines: args.p_lines, reason: args.p_reason, content: args.p_content, parts: args.p_parts, sent_parts: 0, idem_key: args.p_key, status: 'pending' };
      ricoOrders.push(row);
      return Promise.resolve({ data: { id: row.id }, error: null });
    }
    if (name === 'app_internal_ai_usage') {
      const totals = {};
      for (const row of usage) for (const a of row.attempts ?? []) {
        const t = totals[a.provider] ??= { calls: 0, input: 0, output: 0 };
        t.calls += a.answered ? 1 : 0; t.input += a.input; t.output += a.output;
      }
      return Promise.resolve({ data: totals, error: null });
    }
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
        if (action === 'update' && table === 'app_rico_orders') {
          const id = filters.find(([field]) => field === 'id')?.[1]?.[0];
          Object.assign(ricoOrders.find(row => row.id === id), change);
        }
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
    if (whatsappThrows) throw new TypeError('network connection lost');
    return whatsappWindowClosed
      ? new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 })
      : new Response(JSON.stringify({ messages: [{ id: 'wamid.test' + whatsappCalls.length }] }), { headers: { 'content-type': 'application/json' } });
  }
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
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
let whatsappThrows = false;
let anthropicSecondTurnDown = false;
let anthropicFail = null; // { status, type, message } or 'slow'
let anthropicTool = { name: 'open_screen', json: ['{"screen":', '"order"}'] };
const anthropicKey = 'sk-ant-api03-' + 'C'.repeat(40);
const sse = events => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))); controller.close();
} }), { headers: { 'content-type': 'text/event-stream' } });
async function anthropic(url, options) {
  assert.equal(options.headers['x-api-key'], anthropicKey);
  if (anthropicSecondTurnDown && anthropicTurn === 1) { anthropicTurn++; return new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }); }
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
secrets.set('groq_api_key', 'gsk_' + 'B'.repeat(30)); // keys are set on the server only, never from the app
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
assert.equal(aiStatus.get('groq').state, 'busy', 'F19: a reply that ended in an error is not recorded as working');
assert.deepEqual(usage.at(-1).attempts.map(t => [t.provider, t.answered, t.outcome]), [['groq', true, 'busy']], 'F20: each AI try is kept with its outcome');
assert.equal(requests.slice(beforeHalfway).some(r => r.url.includes('streamGenerateContent')), false, 'no second model starts the reply again');
groqTurn = 0; groqTool = 'list_suppliers'; geminiTurn = 1; const beforeLookup = requests.length;
const lookupEvents = await chat();
assert.deepEqual(lookupEvents.map(e => e.type), ['status', 'mood', 'text', 'done'], 'after a lookup with nothing on screen, Gemini still answers');
assert.equal(requests.slice(beforeLookup).some(r => r.url.includes('streamGenerateContent')), true);
groqSecondTurnDown = false; groqTool = 'open_screen';

// Claude Haiku 5.5 answers first once its key is on the server; the free AIs take over when it can't.
secrets.set('anthropic_api_key', anthropicKey);
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
const ai = await adminAi(db);
assert.deepEqual(ai.brains.map(b => [b.id, b.connected]), [['anthropic', true], ['gemini', true], ['groq', true]]);
assert.equal(ai.brains[0].calls >= 1 && ai.brains[0].input >= 232, true);
assert.equal(ai.brains[0].state, 'busy', 'the last answer state is kept');
assert.deepEqual(Object.keys(ai.brains[0]).sort(), ['at', 'calls', 'connected', 'id', 'input', 'output', 'state'], 'no keys and no bill go to the app');
assert.equal(JSON.stringify(ai).includes('sk-ant') || JSON.stringify(ai).includes('gsk_'), false, 'keys never go back to the app');

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
const toolResult = JSON.parse(requests.filter(r => r.url === 'https://api.anthropic.com/v1/messages').at(-1).body.messages.at(-1).content[0].content);
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
const lastToolResult = () => JSON.parse(requests.filter(r => r.url === 'https://api.anthropic.com/v1/messages').at(-1).body.messages.at(-1).content[0].content);
// F09: the same order again within 15 minutes returns the earlier result; no second message.
orderTool({ suppliers: ['Bakery'], items: [{ item_id: 'it-toast', qty: 2 }], language: 'en' });
await chat('Rico, order from the bakery, and 2 toast bread');
assert.equal(whatsappCalls.length, 2, 'a repeated order is not sent twice');
assert.equal(lastToolResult().results[0].status, 'already_sent');
// F09: once a message went out, a failing AI is not replaced by a backup that would send it again.
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 3 }] }); anthropicSecondTurnDown = true;
const beforeFallback = requests.length;
const afterSend = await chat('Rico, send 3 tomatoes yourself');
anthropicSecondTurnDown = false;
assert.equal(whatsappCalls.length, 3);
assert.equal(requests.slice(beforeFallback).some(r => !['api.anthropic.com', 'graph.facebook.com'].includes(new URL(r.url).hostname)), false, 'no backup AI starts the reply again');
assert.equal(afterSend.find(e => e.type === 'error')?.code, 'busy');
// F12: named items are checked like a normal order; one problem and nothing is sent.
for (const [items, problem] of [[[{ item_id: 'it-tomato', qty: 100000 }], /not a valid amount/], [[{ item_id: 'it-tomato', qty: 1.23456 }], /not a valid amount/],
  [[{ item_id: 'it-nope', qty: 1 }], /unknown item_id/], [[{ item_id: 'it-burger', qty: 1 }], /belongs to Bakery, which was not named/]]) {
  orderTool({ suppliers: ['Vegetables'], items });
  await chat('send it');
  assert.equal(whatsappCalls.length, 3, `nothing sent for ${JSON.stringify(items)}`);
  assert.match(lastToolResult().problems.join(' '), problem);
}
kitchen.app_items.find(i => i.id === 'it-tomato').available = false;
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 2 }] });
await chat('send it');
assert.equal(whatsappCalls.length, 3); assert.match(lastToolResult().problems[0], /not available/);
kitchen.app_items.find(i => i.id === 'it-tomato').available = true;
// F11: a long order goes as numbered parts, every line whole; nothing is cut off.
kitchen.app_suppliers.push({ id: 'sup-big', name: 'Big market', phone: '', reminder: null });
for (let k = 0; k < 100; k++) kitchen.app_items.push({ id: 'it-big-' + k, name: `Long item name number ${k} with extra words to fill`, unit_id: 'u-kg', supplier_id: 'sup-big', available: true });
const before11 = whatsappCalls.length;
orderTool({ suppliers: ['Big market'], items: Array.from({ length: 100 }, (_, k) => ({ item_id: 'it-big-' + k, qty: k + 1 })) });
await chat('send the big market order');
const bodies = whatsappCalls.slice(before11).map(c => c.body.text.body);
assert.ok(bodies.length >= 2 && bodies.every(b => b.length <= 4096), 'several messages, each within WhatsApp\'s limit');
assert.match(bodies[0], /^\[TEST\] Big market \(1\/\d+\)/);
for (let k = 0; k < 100; k++) assert.ok(bodies.some(b => b.includes(`number ${k} with extra words to fill: ${k + 1} kg`)), `line ${k} is sent`);
assert.deepEqual([ricoOrders.at(-1).status, ricoOrders.at(-1).sent_parts, ricoOrders.at(-1).parts], ['sent', bodies.length, bodies.length]);
// F10: the hour's limit is reserved before sending; a full hour, or a reservation that can't be made, sends nothing.
const filler = { id: 999, at: Date.now(), status: 'sent', parts: 20, sent_parts: 20, idem_key: 'x'.repeat(64) };
ricoOrders.push(filler);
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 7 }] });
await chat('send it');
assert.equal(lastToolResult().results[0].error, 'limit'); assert.equal(whatsappCalls.length, before11 + bodies.length);
ricoOrders.splice(ricoOrders.indexOf(filler), 1);
reserveFails = true;
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 8 }] });
await chat('send it');
reserveFails = false;
assert.equal(lastToolResult().results[0].error, 'not_recorded', 'no record, no message'); assert.equal(whatsappCalls.length, before11 + bodies.length);
// F09: an unclear outcome (the connection dropped) stays "uncertain" and is never sent again on its own.
whatsappThrows = true;
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 9 }] });
await chat('send it');
whatsappThrows = false;
assert.equal(ricoOrders.at(-1).status, 'uncertain');
const callsAfterUnclear = whatsappCalls.length;
orderTool({ suppliers: ['Vegetables'], items: [{ item_id: 'it-tomato', qty: 9 }] });
await chat('send it again');
assert.equal(whatsappCalls.length, callsAfterUnclear, 'not resent after an unclear outcome');
assert.equal(lastToolResult().results[0].status, 'already_sent');
// F08: a past amount in another unit never becomes a usual amount in the unit the item has now.
{
  const world = await _internals.loadWorld(db, { id: 'r', account: 'rozha', deviceId: null });
  assert.equal(_internals.toolSuggestOrder(world, { suppliers: ['sup-bakery'], ignoreSent: true }).suppliers[0].lines[0].qty, 24);
  world.items.find(i => i.id === 'it-burger').unit_id = 'u-kg';   // the item's unit changed since those orders
  const after = _internals.toolSuggestOrder(world, { suppliers: ['sup-bakery'], ignoreSent: true });
  assert.equal(after.suppliers.length, 0, '24 pieces are not suggested as 24 kg');
}
kitchen = null; anthropicTool = { name: 'open_screen', json: ['{"screen":', '"order"}'] }; anthropicTurn = 0;
secrets.delete('anthropic_api_key');
const beforeNoHaiku = requests.length;
await chat();
assert.equal(requests.slice(beforeNoHaiku).some(r => new URL(r.url).hostname === 'api.anthropic.com'), false, 'without its key Haiku is skipped');

// F01: Rico follows the same roles. Without History he can't read or reveal past orders (tools and the
// instant answers alike); without Record, no change log.
{
  const noHistory = { id: 'y2', account: 'yunis', deviceId: null, roles: ['assistant'] };
  const ask = async (body) => (await (await handleChat(db, noHistory, { messages: [{ role: 'user', content: 'x' }], lang: 'en', ...body }, {}, new AbortController().signal)).text()).trim().split('\n').map(JSON.parse);
  const before = requests.length;
  const last = await ask({ quickAction: 'last_order' });
  assert.match(last.find(e => e.type === 'text').text, /History isn't open for you/, 'the instant answer refuses');
  assert.equal(requests.length, before, 'and no AI is asked');
  const world = await _internals.loadWorld(db, noHistory);
  assert.equal(world.can.history, false); assert.equal(world.can.record, false);
  assert.deepEqual(world.months, []); assert.deepEqual(world.activity, []);
  assert.equal(world.history.every(o => o.lines.every(l => l.itemId === '' && l.qty === 0)), true, 'no items or amounts reach Rico');
  assert.equal((await _internals.runTool(db, world, 'order_history', {}, () => {}, false)).error, 'no_access');
  assert.equal((await _internals.runTool(db, world, 'recent_changes', {}, () => {}, false)).error, 'no_access');
  const full = await _internals.loadWorld(db, { id: 'r', account: 'rozha', deviceId: null });
  assert.equal(full.can.history && full.can.record, true);
}

console.log('Rico provider smoke: PASS (History and Record roles inside Rico; Rico sends test orders by WhatsApp to Rozha only; Claude Haiku first with tool calls, thinking and caching; free AIs take over on no credit, rejected key, busy or slow; Admin AI states and tokens, never keys; Gemini, Groq tool calls, Groq-to-Gemini fallback (never twice), moods (any tag shape), Kurdish to Gemini, quick answers, draft check, insights, empty response)');
