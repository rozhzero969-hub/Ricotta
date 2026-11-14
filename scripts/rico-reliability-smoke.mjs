/* Rico answers reliably (2026-11-14): the reasons a question failed, each reproduced here with mocked AIs.
   - Haiku's 4th round changed the system prompt, so Anthropic refused the thinking block it wrote a round
     earlier ("bound to a different conversation", seen in the live logs). The start of the conversation
     must never change between rounds.
   - A thinking block Anthropic won't take back, an overloaded answer, a dropped connection or an error in
     the middle of the stream are asked once more before the backups; an empty or cut-off Gemini answer
     lets the next AI answer instead of showing an error.
   Run: node scripts/rico-reliability-smoke.mjs */
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: () => '' } };
const { _internals } = await import('../supabase/functions/api/assistant.ts');
const { streamAnthropic, streamGemini } = _internals;

const sse = events => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of events) c.enqueue(e.encode(`data: ${JSON.stringify(x)}\n\n`)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const toolRound = (n) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'look ' + n } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' + n } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_' + n, name: 'list_suppliers', input: {} } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }]);
const answer = (text = 'Done.') => sse([
  { type: 'message_start', message: { usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }]);
const world = () => ({ suppliers: [], items: [], history: [], units: [], can: { history: true, record: true, catalog: true, receipts: true, transfers: true }, acted: false, account: 'rozha', routines: [], rules: [] });
const run = async (replies) => {
  const bodies = [], events = [];
  globalThis.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); const r = replies.shift(); if (typeof r === 'function') return r(); return r; };
  const out = await streamAnthropic({}, world(), 'k', [{ role: 'user', content: 'hello' }], [{ text: 'MANUAL' }, { text: 'CONTEXT' }], e => events.push(e), false, new AbortController().signal, { input: 0, output: 0 }, 0);
  return { out, bodies, events };
};

// 1. Four rounds of lookups: the system prompt and every earlier message stay exactly the same; the
//    "answer now" line goes at the end of the newest message.
{
  const { out, bodies, events } = await run([toolRound(1), toolRound(2), toolRound(3), answer('Here it is.')]);
  assert.equal(out, true);
  assert.equal(bodies.length, 4);
  for (const b of bodies) assert.deepEqual(b.system, bodies[0].system, 'the system prompt never changes between rounds');
  for (let i = 1; i < bodies.length; i++) assert.deepEqual(bodies[i].messages.slice(0, bodies[i - 1].messages.length), bodies[i - 1].messages, 'earlier messages are only ever added to');
  const last = bodies[3].messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result', 'tool results stay first');
  assert.match(last.content.at(-1).text, /answer now/);
  assert.equal(events.filter(e => e.type === 'error').length, 0);
}
// 2. Anthropic refuses a thinking block: the same round again without thinking blocks, then the answer.
{
  const refuse = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.1.content.0: Invalid `signature` in `thinking` block.' } }), { status: 400 });
  const { out, bodies, events } = await run([toolRound(1), refuse, answer()]);
  assert.equal(out, true);
  assert.equal(bodies.length, 3);
  assert.ok(bodies[2].messages.every(m => !Array.isArray(m.content) || m.content.every(b => b.type !== 'thinking')), 'retried without thinking blocks');
  assert.equal(events.some(e => e.type === 'error'), false);
}
// 3. Overloaded, a dropped connection, and an error in the middle of the stream: each asked once more.
{
  const overloaded = () => new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 });
  let r = await run([overloaded, answer()]);
  assert.equal(r.out, true); assert.equal(r.events.some(e => e.type === 'error'), false, 'one overloaded answer is retried');
  r = await run([() => Promise.reject(new TypeError('network')), answer()]);
  assert.equal(r.out, true); assert.equal(r.events.some(e => e.type === 'error'), false, 'a dropped connection is retried');
  r = await run([sse([{ type: 'message_start', message: { usage: {} } }, { type: 'error', error: { type: 'overloaded_error' } }]), answer()]);
  assert.equal(r.out, true); assert.equal(r.events.some(e => e.type === 'error'), false, 'an error mid-stream is retried');
  // Twice in a row with nothing shown: handed to the backups ("busy"), never a hard failure.
  r = await run([overloaded, overloaded]);
  assert.equal(r.out, 'busy');
}
// 4. Gemini: an empty answer or a cut-off stream with nothing shown lets the next AI answer.
{
  const cfg = { provider: 'gemini', key: 'g', model: 'gemini-x', geminiKey: 'g' };
  const gem = async (reply) => {
    globalThis.fetch = async () => reply;
    const events = [];
    const out = await streamGemini({}, world(), cfg, [{ role: 'user', content: 'hi' }], [{ text: 'M' }], e => events.push(e), false, new AbortController().signal, { input: 0, output: 0 }, 0);
    return { out, events };
  };
  let g = await gem(sse([{ candidates: [{ content: { parts: [] } }] }]));
  assert.equal(g.out, 'failed'); assert.equal(g.events.some(e => e.type === 'error'), false, 'an empty Gemini answer is not shown as an error');
  g = await gem(sse([{ error: { code: 503 } }]));
  assert.equal(g.out, 'busy');
  g = await gem(new Response('{}', { status: 500 }));
  assert.equal(g.out, 'busy', 'a Gemini server error is busy, so the next AI answers');
}
console.log('Rico reliability PASS: the conversation start never changes between rounds; thinking, overload, dropped and cut-off answers are retried or handed to the next AI');
