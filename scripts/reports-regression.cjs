// Problem reports and time in the app on the phone (reports.js), run in a small stand-in browser.
// Audit F15 (usage stays with its account), F16 (problems keep their account, acks keep new counts),
// F17 (nothing sensitive is kept).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const store = new Map();
  const sent = [];
  let session = null, reply = null, uuid = 0;
  const listeners = {};
  const ctx = {
    lget: k => (store.has(k) ? JSON.parse(store.get(k)) : null),
    lset: (k, v) => (v === null ? store.delete(k) : store.set(k, JSON.stringify(v))),
    apiSession: () => session,
    api: async (p, o) => { sent.push({ path: p, body: o.body }); return reply ? await reply(p, o) : { ok: true, status: 200 }; },
    APP_VERSION: 'test',
    state: { account: null, view: 'order' },
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    navigator: { onLine: true },
    location: { origin: 'https://app.test' },
    document: { visibilityState: 'visible', addEventListener() {} },
    window: { addEventListener: (t, f) => { listeners[t] = f; } },
    console: { error() {}, log() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'reports.js'), 'utf8') + '\n;globalThis.__r={takeUsage,settleUsage,reportProblem,flushProblems,redactProblem,PROBLEM_KEY};', ctx);
  return { ...ctx.__r, ctx, store, sent, signIn: a => { session = a ? { account: a, token: 't-' + a } : null; ctx.state.account = a; }, setReply: f => { reply = f; } };
}

test('F15: a usage batch stays with the account that counted it', async () => {
  const r = load();
  r.signIn('rozha'); r.ctx.lset('usagePending:rozha', 60);
  const batch = r.takeUsage();
  assert.deepEqual([batch.account, batch.seconds], ['rozha', 60]);
  r.signIn('yunis');
  r.settleUsage(batch, { ok: false, status: 0 });   // the upload failed while Yunis was signed in
  assert.equal(r.ctx.lget('usagePending:yunis'), null, 'Yunis gets none of Rozha\'s time');
  assert.equal(r.takeUsage(), null);
  r.signIn('rozha');
  const again = r.takeUsage();
  assert.equal(again.id, batch.id, 'the same batch (same id) is sent again for Rozha');
  r.settleUsage(again, { ok: true, status: 200 });
  assert.equal(r.ctx.lget('usageOutbox:rozha'), null);
});

test('seconds the server clock did not allow yet go in the next batch, a repeat of a counted batch adds nothing', () => {
  const r = load();
  r.signIn('rozha'); r.ctx.lset('usagePending:rozha', 60);
  r.settleUsage(r.takeUsage(), { ok: true, status: 200, data: { credited: 58 } });
  assert.equal(Math.floor(r.ctx.lget('usagePending:rozha')), 2);
  r.ctx.lset('usagePending:rozha', 60);
  r.settleUsage(r.takeUsage(), { ok: true, status: 200, data: { credited: 0 } });
  assert.equal(Math.floor(r.ctx.lget('usagePending:rozha') || 0), 0, 'the same batch sent again was already counted');
  r.ctx.lset('usagePending:rozha', 60);
  r.settleUsage(r.takeUsage(), { ok: true, status: 200 });
  assert.equal(Math.floor(r.ctx.lget('usagePending:rozha') || 0), 0, 'no answer about it, nothing added');
});

test('F16: problems keep their account; an ack removes only what was sent', async () => {
  const r = load();
  r.signIn('rozha'); r.reportProblem('error', 'Rozha broke it');
  r.signIn('yunis'); r.reportProblem('error', 'Yunis broke it');
  let during = null;
  r.setReply(async () => { if (during) during(); return { ok: true, status: 200 }; });
  during = () => { r.reportProblem('error', 'Yunis broke it'); during = null; };   // happens again while sending
  await r.flushProblems();
  assert.deepEqual(r.sent[0].body.reports.map(p => p.message), ['Yunis broke it'], 'only Yunis\'s problem goes with Yunis');
  const left = r.ctx.lget(r.PROBLEM_KEY);
  assert.deepEqual(left.map(p => [p.account, p.message, p.count]), [['rozha', 'Rozha broke it', 1], ['yunis', 'Yunis broke it', 1]], 'the new occurrence is kept');
  r.signIn(null); r.reportProblem('error', 'before sign-in');
  assert.equal(r.ctx.lget(r.PROBLEM_KEY).at(-1).screen, 'signin');
});

test('F17: nothing sensitive is kept', () => {
  const r = load();
  r.signIn('rozha');
  r.reportProblem('console', 'PIN 482916 token abcdefghijklmnop1234567890abcdef12 key sk-ant-api03-SECRETSECRET at https://x.test/p?pin=482916 call 0750 969 2627');
  const kept = JSON.stringify(r.ctx.lget(r.PROBLEM_KEY));
  assert.doesNotMatch(kept, /482916|abcdefghijklmnop|SECRETSECRET|pin=|969 2627/);
  assert.equal(r.redactProblem('order 12 items'), 'order 12 items', 'ordinary text stays');
});
