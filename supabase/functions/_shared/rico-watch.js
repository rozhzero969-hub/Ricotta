/* Short-lived permission to read only the local helper's screen. Never shares the Orders session. */
const TTL = 60_000;
const encode = new TextEncoder();
const bytes = hex => Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
const hex = data => [...new Uint8Array(data)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const payload = value => encode.encode('ricotta-local-screen:v1:' + value);
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encode.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function issueWatchTicket(secret, now = Date.now()) {
  const expires = now + TTL;
  const value = expires + '.' + hex(crypto.getRandomValues(new Uint8Array(16)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), payload(value));
  return { ticket: value + '.' + hex(signature), expires };
}
export async function verifyWatchTicket(secret, ticket, now = Date.now()) {
  const match = /^(\d{13}\.[a-f\d]{32})\.([a-f\d]{64})$/.exec(ticket || '');
  if (!match) return false;
  const expiry = Number(match[1].split('.')[0]);
  if (expiry <= now || expiry > now + TTL + 5000) return false;
  return crypto.subtle.verify('HMAC', await signingKey(secret), bytes(match[2]), payload(match[1]));
}
