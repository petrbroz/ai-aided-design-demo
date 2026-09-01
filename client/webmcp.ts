/**
 * The WebMCP layer and nothing else: what a tool looks like, how a tool's arguments
 * are validated, how its result is wrapped in the text envelope WebMCP understands
 * today, and the registration lifecycle. It knows nothing about the viewer.
 *
 * The tool surface is a function of what is on screen: registration is scoped to an
 * AbortController that is aborted before a different model loads.
 */

export type Json = Record<string, unknown>;

/**
 * One agent-facing capability. `run` receives arguments already checked against
 * `inputSchema`, and returns plain values or throws; the envelope, the argument
 * checking, the logging and the error handling are added once, here.
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

/* ------------------------------------------------------------ input validation */

/**
 * A validator for the subset of JSON Schema these tools actually use. The host is
 * not required to enforce `inputSchema`, and the arguments are model-generated, so
 * an unchecked `position: [1, 2]` would otherwise reach THREE.Vector3 and leave the
 * user with a NaN camera to undo by hand. Failing here costs the agent one retry
 * with a message that says exactly which field was wrong.
 */
function fail(path: string, message: string): never {
  throw new Error(`${path || "arguments"}: ${message}`);
}

function validate(value: unknown, schema: any, path: string): void {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    fail(path, `expected one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}`);
  }

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail(path, "expected an object");
      }
      const properties = schema.properties ?? {};
      const child = (key: string) => (path ? `${path}.${key}` : key);

      for (const key of schema.required ?? []) {
        if ((value as Json)[key] === undefined) fail(child(key), "is required");
      }
      for (const [key, item] of Object.entries(value as Json)) {
        if (item === undefined) continue;
        if (!properties[key]) {
          if (schema.additionalProperties === false) fail(child(key), "is not a known argument");
          continue;
        }
        validate(item, properties[key], child(key));
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) fail(path, "expected an array");
      const { minItems, maxItems, items } = schema;
      if (minItems !== undefined && value.length < minItems) {
        fail(path, `expected at least ${minItems} item(s), got ${value.length}`);
      }
      if (maxItems !== undefined && value.length > maxItems) {
        fail(path, `expected at most ${maxItems} item(s), got ${value.length}`);
      }
      if (items) value.forEach((item, i) => validate(item, items, `${path}[${i}]`));
      return;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
      return;
    case "string":
      if (typeof value !== "string") fail(path, "expected a string");
      return;
    case "boolean":
      if (typeof value !== "boolean") fail(path, "expected a boolean");
      return;
  }
}

/* -------------------------------------------------- state-conditional lifecycle */

function modelContext(): WebMcpModelContext | undefined {
  return (document as any).modelContext ?? (navigator as any).modelContext;
}

export function isWebMcpAvailable(): boolean {
  return Boolean(modelContext());
}

/**
 * Always text, never throw. Failures come back as `{ error }` *and* `isError: true`
 * — without the flag a failed call reads to the agent as a successful one whose
 * payload happens to contain the word "error".
 */
function descriptor({ run, ...spec }: ToolSpec): WebMcpToolDescriptor {
  const text = (result: unknown, isError = false): WebMcpToolResult => ({
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError,
  });

  return {
    ...spec,
    execute: async (args: any) => {
      const input = args ?? {};
      try {
        validate(input, spec.inputSchema, "");
        const result = await run(input);
        console.log(`${spec.name}`, input);
        return text(result);
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        console.warn(`${spec.name} failed — ${message}`, input);
        return text({ error: message }, true);
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
