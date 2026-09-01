/**
 * The WebMCP layer and nothing else: what a tool looks like, how a tool's result is
 * wrapped in the text envelope WebMCP understands today, and the registration
 * lifecycle. It knows nothing about the viewer.
 *
 * The tool surface is a function of what is on screen: registration is scoped to an
 * AbortController that is aborted before a different model loads.
 */

export type Json = Record<string, unknown>;

/**
 * One agent-facing capability. `run` returns (or throws) plain values; the envelope
 * and the error handling are added once, here.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: any) => unknown;
}

/* --------------------------------------------------------------- schema helpers */

export const numberArray = (description: string) => ({
  type: "array",
  items: { type: "number" },
  description,
});

export const vec3 = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: `${description} [x, y, z]`,
});

/* -------------------------------------------------- state-conditional lifecycle */

function modelContext(): WebMcpModelContext | undefined {
  return (document as any).modelContext ?? (navigator as any).modelContext;
}

export function isWebMcpAvailable(): boolean {
  return Boolean(modelContext());
}

/** Always text, never throw — return `{ error }` so the agent can recover. */
function descriptor({ run, ...spec }: ToolSpec): WebMcpToolDescriptor {
  const text = (result: unknown): WebMcpToolResult => ({
    content: [{ type: "text", text: JSON.stringify(result) }],
  });
  return {
    ...spec,
    execute: async (args: any) => {
      try {
        return text(await run(args ?? {}));
      } catch (err) {
        return text({ error: (err as Error).message ?? String(err) });
      }
    },
  };
}

let controller: AbortController | null = null;

/**
 * Register a tool surface, holding the AbortController so it can be torn down
 * before another model loads. Returns the registered names, or `[]` when there is
 * no model context — in which case the app is simply manual.
 */
export async function registerTools(tools: ToolSpec[]): Promise<string[]> {
  const mc = modelContext();
  if (!mc) return [];

  unregisterTools();
  controller = new AbortController();

  for (const spec of tools) {
    await mc.registerTool(descriptor(spec), { signal: controller.signal });
  }
  return tools.map((t) => t.name);
}

export function unregisterTools(): void {
  controller?.abort();
  controller = null;
}
