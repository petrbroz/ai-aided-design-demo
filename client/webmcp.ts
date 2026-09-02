export type Json = Record<string, unknown>;

/** `run` receives arguments already checked against `inputSchema`, and returns or throws. */
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

// The host is not required to enforce `inputSchema` and the arguments are
// model-generated, so an unchecked `position: [1, 2]` would reach Math.Vector3 and leave
// the user with a NaN camera to undo by hand. Failing here costs the agent one retry.
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
 * Always text, never throw. Failures carry `{ error }` *and* `isError: true` — without
 * the flag a failure reads as a success whose payload happens to contain "error".
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

/** Returns the registered names, or `[]` with no model context — the app is then manual. */
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
