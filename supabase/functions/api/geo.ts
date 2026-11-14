// Where a sign-in came from, for Admin's device list: the address, and the place ipinfo.io gives for it
// (city, region, country, network and the address's time zone). Rozh approved ipinfo.io (2026-11-14);
// only the address is sent, nothing about the person. It never slows or stops a sign-in: the lookup
// runs after the reply, with a 4 second limit, and any failure just leaves the place empty.
//
// A sign-in is flagged as a likely VPN when the network belongs to a hosting or VPN company, or when
// the phone's own time zone (which a VPN does not change) is not the address's time zone.

export type Place = {
  ip: string | null; city: string | null; region: string | null; country: string | null; org: string | null;
  ipTz: string | null; deviceTz: string | null; vpn: boolean | null; vpnReason: "org" | "tz" | null;
};

const LOOKUP_MS = 4000;
const str = (v: unknown, max: number) => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, max) : null; };

/* The address the request came from (the platform puts the client first). */
export function clientIp(req: Request): string | null {
  const first = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(first) && (first.includes(".") || first.includes(":")) ? first : null;
}

/* A time zone name as the phone reports it ("Asia/Baghdad"), or null. */
export function cleanTimeZone(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(s) || s.length > 40) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: s }); return s; } catch { return null; }
}

/* Private, local and reserved addresses have no place to look up. */
export function isPublicIp(ip: string | null): boolean {
  if (!ip) return false;
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return !(v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("::ffff:") || v.startsWith("2001:db8"));
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}

/* Networks that belong to hosting or VPN companies: a person at a phone is almost never on one. */
const VPN_ORG = /hosting|datacenter|data center|vpn|proxy|m247|digitalocean|amazon|google cloud|microsoft azure|ovh|hetzner|linode|akamai|vultr|choopa|leaseweb|datacamp|proton|nordvpn|mullvad|surfshark|express ?vpn|cloudflare|fastly/i;

export async function placeOf(ip: string | null, deviceTz: string | null): Promise<Place> {
  const place: Place = { ip, city: null, region: null, country: null, org: null, ipTz: null, deviceTz, vpn: null, vpnReason: null };
  if (!ip || !isPublicIp(ip)) return place;
  const token = (globalThis as any).Deno?.env?.get?.("IPINFO_TOKEN") as string | undefined;
  try {
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      { signal: AbortSignal.timeout(LOOKUP_MS), headers: { Accept: "application/json" } });
    if (!res.ok) return place;
    const d: any = await res.json();
    if (d?.bogon) return place;
    place.city = str(d?.city, 80); place.region = str(d?.region, 80);
    place.country = /^[A-Z]{2}$/.test(String(d?.country ?? "")) ? d.country : null;
    place.org = str(d?.org, 120); place.ipTz = cleanTimeZone(d?.timezone);
  } catch { return place; }
  // Time zones are compared by their clock offset now, not their names: Asia/Riyadh and Europe/Istanbul
  // are the same time as Asia/Baghdad, and that is not a VPN.
  const sameClock = deviceTz && place.ipTz ? offsetMin(deviceTz) === offsetMin(place.ipTz) : null;
  // iPhones with iCloud Private Relay come through Akamai, Cloudflare or Fastly but keep the real region.
  const relay = !!place.org && RELAY_ORG.test(place.org) && sameClock !== false;
  if (place.org && VPN_ORG.test(place.org) && !relay) { place.vpn = true; place.vpnReason = "org"; }
  else if (sameClock !== null) { place.vpn = !sameClock; place.vpnReason = place.vpn ? "tz" : null; }
  else if (place.org || place.ipTz) place.vpn = false;
  return place;
}
const RELAY_ORG = /akamai|cloudflare|fastly/i;
/* Minutes ahead of UTC in that time zone right now (null if unknown). */
export function offsetMin(tz: string, at = new Date()): number | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = name.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  } catch { return null; }
}
