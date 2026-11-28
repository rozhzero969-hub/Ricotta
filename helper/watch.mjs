import { createServer } from 'node:http';
import { verifyWatchTicket } from '../supabase/functions/_shared/rico-watch.js';

export const WATCH_PORT = 17692;
const ORDERS_ORIGIN = 'https://rozhzero969-hub.github.io';
const localHost = '127.0.0.1';

export async function setupWatchCursor(page, origin) {
  await page.addInitScript(origin => {
    if(location.origin !== origin || window.top !== window) return;
    const mark = (x, y, mode) => { window.__ricoWatchPointer = [x / innerWidth, y / innerHeight, mode, performance.now()]; };
    addEventListener('pointermove', event => {
      if(event.isTrusted) mark(event.clientX, event.clientY, 'point');
    }, {passive:true});
    addEventListener('pointerdown', event => {
      if(event.isTrusted) mark(event.clientX, event.clientY, 'press');
    }, {passive:true});
    const typing = event => {
      const field = event.target;
      if(!event.isTrusted || !field.matches?.('input:not([type=password]):not([type=checkbox]), textarea, [contenteditable=true]')) return;
      const rect = field.getBoundingClientRect();
      if(rect.width && rect.height) mark(rect.left + Math.min(18, rect.width / 2), rect.top + rect.height / 2, 'type');
    };
    addEventListener('focusin', typing);
    addEventListener('input', typing);
  }, origin);
}

export async function captureWatchFrame(page, origin, isSignedIn) {
  const safePage = () => page.evaluate(expected => {
    if(location.origin !== expected || !/^\/inventory(?:\/|$)/.test(location.pathname) ||
      document.readyState === 'loading' || document.querySelector('input[type=password]')) return null;
    const pointer = window.__ricoWatchPointer?.slice();
    if(pointer?.[2] === 'press' && performance.now() - pointer[3] > 220) pointer[2] = 'point';
    return { identity: location.href + ':' + performance.timeOrigin, pointer: pointer?.slice(0, 3) };
  }, origin).catch(() => null);
  if (!isSignedIn()) return null;
  const before = await safePage();
  if (!before) return null;
  const image = await page.screenshot({ type: 'jpeg', quality: 63, scale: 'css', timeout: 1000 });
  const after = await safePage();
  if (!isSignedIn() || before.identity !== after?.identity) return null;
  const raw = after.pointer;
  const pointer = Array.isArray(raw) && raw.length === 3 &&
    raw.slice(0, 2).every(n => Number.isFinite(n) && n >= 0 && n <= 1) &&
    ['point', 'press', 'type'].includes(raw[2]) ? raw : null;
  return { image, pointer };
}

export function startWatchServer({ secret, capture, port = WATCH_PORT, origin = ORDERS_ORIGIN, onError = () => {} }) {
  let capturing = false, lastCapture = -Infinity;
  const server = createServer({ maxHeaderSize: 4096, requestTimeout: 4000 }, async (req, res) => {
    const send = (code, body, headers = {}) => {
      if (res.destroyed) return;
      res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };
    if (req.headers.origin !== origin || req.headers.host !== localHost + ':' + server.address()?.port) {
      send(403);
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'X-Rico-Pointer');
    res.setHeader('Vary', 'Origin');
    if (!['/ready', '/frame'].includes(req.url)) { send(404); return; }
    if (req.method === 'OPTIONS') {
      send(204, undefined, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '60' });
      return;
    }
    if (req.method !== 'GET') { send(405); return; }
    if (req.url === '/ready') { send(204); return; }
    try {
      const ticket = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!await verifyWatchTicket(secret, ticket)) { send(401); return; }
      if (capturing || performance.now() - lastCapture < 140) { send(429); return; }
      capturing = true;
      lastCapture = performance.now();
      let frame;
      try { frame = await capture(); } finally { capturing = false; }
      if (!frame) { send(204); return; }
      send(200, frame.image, { 'Content-Type': 'image/jpeg', 'X-Rico-Pointer': frame.pointer?.join(',') || '' });
    } catch {
      send(503);
    }
  });
  server.on('error', onError);
  server.maxConnections = 10;
  return server.listen(port, localHost);
}
