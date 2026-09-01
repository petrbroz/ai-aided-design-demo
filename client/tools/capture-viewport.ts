import type { ToolSpec } from "../webmcp.js";
import { requireViewer } from "../viewer.js";
import { clamp, withTimeout } from "../utils.js";

/** Largest screenshot side, in pixels. */
const MAX_DIMENSION = 2048;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const RENDER_TIMEOUT_MS = 30_000;

async function captureViewport(width: number, height: number) {
  const viewer = requireViewer();
  const w = clamp(Math.round(width), 1, MAX_DIMENSION);
  const h = clamp(Math.round(height), 1, MAX_DIMENSION);

  viewer.impl.invalidate(true, true, true);

  // getScreenShot has no failure callback: if the render never completes the promise
  // never settles and the agent's tool call hangs forever. Bound it.
  const dataUrl = await withTimeout(
    new Promise<string>((resolve) => viewer.getScreenShot(w, h, resolve)),
    RENDER_TIMEOUT_MS,
    `Screenshot render timed out after ${RENDER_TIMEOUT_MS / 1000}s.`
  );
  if (!dataUrl) throw new Error("The viewer returned an empty screenshot.");

  const res = await fetch("/api/screenshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ png: dataUrl }),
  });
  if (!res.ok) throw new Error(`Screenshot upload failed (${res.status}): ${await res.text()}`);
  const { url } = (await res.json()) as { url: string };

  return { url, width: w, height: h, note: "Fetch this URL to view the current viewport." };
}

export const captureViewportTool: ToolSpec = {
  name: "capture-viewport",
  description:
    "Render the current viewport to a PNG and return its URL. WebMCP cannot return " +
    "images yet, so you must FETCH that URL to actually see the screenshot. Use it to " +
    "verify a camera move, an isolation, a section or a colour scheme after applying it.",
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
