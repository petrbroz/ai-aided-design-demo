/**
 * Pure helpers with no knowledge of the viewer or of WebMCP: list capping, number
 * coercion, colour parsing, and the one-line JSON fetch used against our own API.
 */

/** Hard cap on any list a caller may receive. Token budget is a design constraint. */
export const MAX_ITEMS = 50;

/** Truncate a list to `limit` (default MAX_ITEMS), always reporting the true total. */
export function cap<T, R = T>(items: T[], map?: (item: T) => R, limit = MAX_ITEMS) {
  const kept = items.slice(0, limit);
  return {
    total: items.length,
    returned: kept.length,
    truncated: items.length > kept.length,
    items: map ? kept.map(map) : (kept as unknown as R[]),
  };
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid color "${hex}" — expected #RRGGBB.`);
  const int = parseInt(m[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
