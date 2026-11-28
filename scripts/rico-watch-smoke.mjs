import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { captureWatchFrame, setupWatchCursor, startWatchServer } from '../helper/watch.mjs';
import { issueWatchTicket } from '../supabase/functions/_shared/rico-watch.js';

const browser = await chromium.launch();
const pos = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/inventory/login'
    ? '<input type="password" aria-label="Password">'
    : '<input aria-label="Invoice number">');
}).listen(0, '127.0.0.1');
let watch;
try {
  await once(pos, 'listening');
  const posOrigin = 'http://127.0.0.1:' + pos.address().port;
  const ordersOrigin = 'https://orders.example.test';
  const page = await browser.newPage();
  await setupWatchCursor(page, posOrigin);
  await page.goto(posOrigin + '/inventory/new-receipt');
  const invoice = page.getByRole('textbox', { name: 'Invoice number' });
  await invoice.hover();
  const capture = () => captureWatchFrame(page, posOrigin, () => true);
  assert.equal((await capture()).pointer?.[2], 'point');
  await invoice.click();
  await page.keyboard.type('1042');
  assert.equal(await invoice.inputValue(), '1042');
  assert.equal(await captureWatchFrame(page, posOrigin, () => false), null);

  const secret = 'local-viewer-fixture-secret';
  const { ticket } = await issueWatchTicket(secret);
  watch = startWatchServer({ secret, capture, port: 0, origin: ordersOrigin });
  await once(watch, 'listening');
  const endpoint = 'http://127.0.0.1:' + watch.address().port + '/frame';
  const headers = { origin: ordersOrigin, authorization: 'Bearer ' + ticket };
  assert.equal((await fetch(endpoint, { headers: { ...headers, origin: posOrigin } })).status, 403);
  assert.equal((await fetch(endpoint, { headers: { origin: ordersOrigin } })).status, 401);
  const frame = await fetch(endpoint, { headers });
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.equal(frame.headers.get('cache-control'), 'no-store');
  assert.match(frame.headers.get('x-rico-pointer'), /,type$/);
  assert.deepEqual([...new Uint8Array(await frame.arrayBuffer()).slice(0, 2)], [255, 216]);
  await page.goto(posOrigin + '/inventory/login');
  assert.equal(await capture(), null, 'the viewer never captures a password form');
  await page.goto(posOrigin + '/login');
  assert.equal(await capture(), null, 'only inventory pages are visible');
  console.log('Watch Rico PASS: real browser frames, pointer and typing, private ticket, and no login frames');
} finally {
  watch?.close();
  pos.close();
  await browser.close();
}
