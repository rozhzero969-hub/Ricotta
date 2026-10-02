/* The PC signing in to the workplace by itself, against a local copy of the sign-in page.
   Run: node scripts/signin-worker-smoke.mjs   (EDGE_PATH can select a Chromium/Edge executable.) */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { onLoginPage, signIn } from '../worker/signin.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const login = fs.readFileSync(path.join(here, 'fixtures/login-page.html'));
const server = http.createServer((rq, res) => {
  const p = new URL(rq.url, 'http://x').pathname;
  res.setHeader('Content-Type', 'text/html');
  if (p === '/login') return res.end(login);
  if (p === '/inventory/transfer') return res.end('<!doctype html><h1>Move stock between storages</h1>');
  res.statusCode = 404; res.end('nope');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || undefined });
try {
  const page = await browser.newPage();
  // Not on the sign-in page: nothing happens.
  await page.goto(base + '/inventory/transfer');
  assert.equal(await onLoginPage(page), false);
  assert.equal(await signIn(page, '123456'), false, 'already signed in: no keys are pressed');
  // Signed out: picks the PIN tab, presses each key, and leaves the sign-in page.
  await page.goto(base + '/login');
  assert.equal(await onLoginPage(page), true);
  assert.equal(await signIn(page, '123456'), true);
  assert.equal(new URL(page.url()).pathname, '/inventory/transfer');
  assert.equal(await onLoginPage(page), false);
  // A wrong PIN fails once, without retrying, and the message never contains the PIN.
  await page.goto(base + '/login');
  const err = await signIn(page, '654321', { timeout: 1500 }).then(() => null, e => e);
  assert.ok(err && /Still on the sign-in page/.test(err.message), 'a wrong PIN is reported');
  assert.ok(!err.message.includes('654321'), 'the PIN is never in a message');
  assert.equal(await page.evaluate(() => window.wrongTries), 1, 'exactly one try, no automatic retry');
  // No PIN configured: refuses before touching the page.
  await page.goto(base + '/login');
  await assert.rejects(signIn(page, ''), /WORKPLACE_PIN is not set/);
  assert.equal(await page.evaluate(() => document.getElementById('dots').textContent), '', 'no key was pressed');
  console.log('Sign-in worker smoke: PASS (PIN tab, keypad, leaves sign-in page, one try only, PIN never in messages)');
} finally { await browser.close(); server.close(); }
