// The URLs are unauthenticated, so an unbounded cache would keep every frame of geometry
// ever captured readable for the process lifetime. Map preserves insertion order.
const MAX_SCREENSHOTS = 32;
const cache = new Map<string, Uint8Array<ArrayBuffer>>();

/** Accepts a data URL or raw base64; throws if it is neither. */
export function saveScreenshot(png: string): string {
  const base64 = png.startsWith("data:") ? png.slice(png.indexOf(",") + 1) : png;
  const bytes = Uint8Array.fromBase64(base64);
  const id = crypto.randomUUID();
  cache.set(id, bytes);
  while (cache.size > MAX_SCREENSHOTS) {
    cache.delete(cache.keys().next().value!);
  }
  return id;
}

export function getScreenshot(id: string): Uint8Array<ArrayBuffer> | undefined {
  return cache.get(id.replace(/\.png$/i, ""));
}
