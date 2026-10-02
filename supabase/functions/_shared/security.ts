// Shared request checks for the PIN-session API and its internal push worker.
export class BodyTooLarge extends Error {}
export class InvalidBody extends Error {}

export async function readJsonBody(req: Request, max = 256 * 1024): Promise<Record<string, any>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) throw new BodyTooLarge();
  if (!req.body) return {};
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, raw = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof BodyTooLarge) throw error;
    throw new InvalidBody();
  } finally {
    reader.releaseLock();
  }
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidBody();
    return body;
  } catch {
    throw new InvalidBody();
  }
}

// Web Push endpoints are server-side fetch destinations. Accept only known
// browser push services, so a subscription cannot target an internal host.
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000 || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" || host === "android.googleapis.com"
      || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com"
      || host === "notify.windows.com" || host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}
