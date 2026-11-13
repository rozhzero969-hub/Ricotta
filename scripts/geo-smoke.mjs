// Sign-in places (supabase/functions/api/geo.ts): private addresses are never looked up, the token is
// never in the result, a hosting or VPN network or a different time zone flags a likely VPN, and a
// failed or slow lookup just leaves the place empty.
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: k => k === 'IPINFO_TOKEN' ? 'secret-token' : undefined } };
const geo = await import('../supabase/functions/api/geo.ts');

for (const ip of ['10.1.2.3', '192.168.0.4', '127.0.0.1', '172.20.1.1', '100.70.0.1', '::1', 'fd00::1', 'fe80::1', null]) assert.equal(geo.isPublicIp(ip), false, String(ip));
for (const ip of ['185.12.40.7', '8.8.8.8', '2a02:4780:10::5']) assert.equal(geo.isPublicIp(ip), true, ip);
assert.equal(geo.cleanTimeZone('Asia/Baghdad'), 'Asia/Baghdad');
assert.equal(geo.cleanTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
for (const bad of ['', 'Nowhere/City', '<script>', 'a'.repeat(60), 42]) assert.equal(geo.cleanTimeZone(bad), null);
const req = h => new Request('https://x/', { headers: h });
assert.equal(geo.clientIp(req({ 'x-forwarded-for': '185.12.40.7, 10.0.0.1' })), '185.12.40.7');
assert.equal(geo.clientIp(req({ 'x-forwarded-for': 'not an ip' })), null);

let calls = [];
const answer = body => { globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 200 }); }; };
// A private address: no lookup at all.
answer({}); calls = [];
let p = await geo.placeOf('192.168.1.5', 'Asia/Baghdad');
assert.equal(calls.length, 0); assert.equal(p.vpn, null);
// Home network in Erbil, phone in Baghdad time: not a VPN.
answer({ ip: '185.12.40.7', city: 'Erbil', region: 'Erbil', country: 'IQ', org: 'AS206206 Korek Telecom', timezone: 'Asia/Baghdad' });
p = await geo.placeOf('185.12.40.7', 'Asia/Baghdad');
assert.equal(p.city, 'Erbil'); assert.equal(p.country, 'IQ'); assert.equal(p.vpn, false); assert.equal(p.vpnReason, null);
assert.ok(calls.at(-1).includes('token=secret-token'), 'the token goes only in the request');
assert.ok(!JSON.stringify(p).includes('secret-token'), 'the token is never returned');
// A VPN company's network.
answer({ city: 'Frankfurt am Main', country: 'DE', org: 'AS9009 M247 Europe SRL', timezone: 'Europe/Berlin' });
p = await geo.placeOf('185.213.155.10', 'Europe/Berlin');
assert.equal(p.vpn, true); assert.equal(p.vpnReason, 'org');
// A home network abroad while the phone is on Baghdad time.
answer({ city: 'Berlin', country: 'DE', org: 'AS3320 Deutsche Telekom AG', timezone: 'Europe/Berlin' });
p = await geo.placeOf('91.0.0.1', 'Asia/Baghdad');
assert.equal(p.vpn, true); assert.equal(p.vpnReason, 'tz');
// The lookup fails or hangs: the place stays empty, nothing throws.
globalThis.fetch = async () => { throw new Error('down'); };
p = await geo.placeOf('91.0.0.1', 'Asia/Baghdad');
assert.equal(p.city, null); assert.equal(p.vpn, null); assert.equal(p.ip, '91.0.0.1');
globalThis.fetch = async () => new Response('nope', { status: 429 });
p = await geo.placeOf('91.0.0.1', null);
assert.equal(p.country, null);
console.log('Sign-in places PASS: private addresses skipped, token never returned, VPN by network or time zone, failures leave the place empty');
