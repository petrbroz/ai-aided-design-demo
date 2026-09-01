import type { ToolSpec } from "../webmcp.js";
import { requireViewer, toNamed } from "../viewer.js";
import { cap, clamp, MAX_ITEMS } from "../utils.js";

async function searchDesign(query: string, maxResults: number) {
  const viewer = requireViewer();
  const limit = clamp(maxResults, 1, MAX_ITEMS);

  const dbIds = await new Promise<number[]>((resolve) => {
    viewer.search(
      query,
      (ids: number[]) => resolve(ids ?? []),
      () => resolve([]),
      ["name"]
    );
  });

  return { query, ...cap(dbIds, toNamed, limit) };
}

export const searchDesignTool: ToolSpec = {
  name: "search-design",
  description:
    "Find objects in the loaded design by name substring (e.g. 'door', 'pipe', " +
    "'Basic Wall'). Matches object names only — not properties or categories; use " +
    "get-properties with a group-by aggregation to explore by category. Returns " +
    `{ total, returned, items: [{ dbId, name }] }, capped at ${MAX_ITEMS} items.`,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name substring to search for." },
      maxResults: { type: "number", description: `Max items to return (1..${MAX_ITEMS}).` },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run: (args) => searchDesign(args.query, args.maxResults ?? MAX_ITEMS),
};
