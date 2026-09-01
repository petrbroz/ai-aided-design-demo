import type { ToolSpec } from "../webmcp.js";
import { requireViewer } from "../viewer.js";
import { clamp } from "../utils.js";

/** Largest screenshot side, in pixels. */
const MAX_DIMENSION = 2048;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

async function captureViewport(width: number, height: number) {
  const viewer = requireViewer();
  const w = clamp(Math.round(width), 1, MAX_DIMENSION);
  const h = clamp(Math.round(height), 1, MAX_DIMENSION);

  viewer.impl.invalidate(true, true, true);
  const dataUrl = await new Promise<string>((resolve) => {
    viewer.getScreenShot(w, h, (url: string) => resolve(url));
  });

  const res = await fetch("/api/screenshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ png: dataUrl }),
  });
  if (!res.ok) {
    return { error: `Screenshot upload failed (${res.status}): ${await res.text()}` };
  }
  const { url } = (await res.json()) as { url: string };

  console.log(`capture-viewport: ${w}×${h}`);

  return { url, width: w, height: h, note: "Fetch this URL to view the current viewport." };
}

export const captureViewportTool: ToolSpec = {
  name: "capture-viewport",
  description:
    "Render the current viewport to a PNG and return a public URL. WebMCP cannot " +
    "return images yet, so you must FETCH the returned URL to actually see the " +
    "screenshot. Use it to verify a camera move, an isolation, a section or a colour " +
    `scheme after applying it. Default ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}, clamped to ${MAX_DIMENSION} per side.`,
  inputSchema: {
    type: "object",
    properties: {
      width: { type: "number", description: `Pixels, max ${MAX_DIMENSION}. Default ${DEFAULT_WIDTH}.` },
      height: { type: "number", description: `Pixels, max ${MAX_DIMENSION}. Default ${DEFAULT_HEIGHT}.` },
    },
    additionalProperties: false,
  },
  run: (args) => captureViewport(args.width ?? DEFAULT_WIDTH, args.height ?? DEFAULT_HEIGHT),
};
