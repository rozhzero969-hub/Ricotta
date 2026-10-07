// Baghdad currently uses UTC+03:00 throughout the year.
export function monthKey(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 7);
}
export function monthStart(now = new Date()): string {
  return new Date(`${monthKey(now)}-01T00:00:00+03:00`).toISOString();
}
