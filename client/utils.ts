/** Hard cap on any list a caller may receive. Token budget is a design constraint. */
export const MAX_ITEMS = 50;

export interface Capped<T> {
  total: number;
  returned: number;
  truncated: boolean;
  items: T[];
}

/**
 * Truncate to `limit`, always reporting the true total. `map` runs only over the kept
 * slice, so it is safe for it to be expensive. Every list a tool returns uses this shape.
 */
export function cap<T, R = T>(items: T[], map?: (item: T) => R, limit = MAX_ITEMS): Capped<R> {
  const kept = items.slice(0, limit);
  return {
    total: items.length,
    returned: kept.length,
    truncated: items.length > kept.length,
    items: map ? kept.map(map) : (kept as unknown as R[]),
  };
}

// Deliberately strict: the *whole* string must be a number with an optional unit suffix,
// so Revit's `8' - 6"` is rejected rather than truncated to `8` and folded into a sum.
const NUMERIC = /^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)[a-zA-Z°²³^/.\s]*$/;

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = NUMERIC.exec(value.trim().replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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

/** Bucket by a string key, largest bucket first. */
export function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(item);
    else buckets.set(k, [item]);
  }
  return [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** Distinct strings, most frequent first. */
export function distinct(values: string[]): string[] {
  return groupBy(values, (v) => v).map(([value]) => value);
}

export async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
