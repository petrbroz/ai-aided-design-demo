import type { ToolSpec } from "../webmcp.js";
import { requireViewer, toNamed } from "../viewer.js";
import { cap, clamp, MAX_ITEMS } from "../utils.js";

async function searchDesign(query: string, maxResults: number) {
  const viewer = requireViewer();

  // Rejecting rather than resolving `[]` — "the search failed" and "nothing matched"
  // must not look identical to the agent.
  const dbIds = await new Promise<number[]>((resolve, reject) => {
    viewer.search(
      query,
      (ids: number[]) => resolve(ids ?? []),
      (err: unknown) => reject(new Error(`Search failed: ${String(err)}`)),
      ["name"]
    );
  });

  return { query, results: cap(dbIds, toNamed, clamp(maxResults, 1, MAX_ITEMS)) };
}

export const searchDesignTool: ToolSpec = {
  name: "search-design",
  description:
    "Find objects whose *name* contains a substring (e.g. 'door', 'pipe', 'Basic " +
    "Wall'). Names only — to search by category or any other property, use " +
    "get-properties with a group-by aggregation.",
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
