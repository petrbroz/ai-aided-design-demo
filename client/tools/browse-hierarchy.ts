import type { ToolSpec } from "../webmcp.js";
import { hierarchyStep, rootDbId } from "../viewer.js";
import { clamp, MAX_ITEMS } from "../utils.js";

export const browseHierarchyTool: ToolSpec = {
  name: "browse-hierarchy",
  description:
    "Walk the design's logical hierarchy one level at a time — the tree the model " +
    "browser shows, e.g. model > level > category > family > instance. Returns the " +
    "node, its breadcrumb of `ancestors` back to the root, and its immediate " +
    "`children`, each flagged `isLeaf`. Recurse with a child's dbId, or the last " +
    "ancestor's to go back up. To find specific objects across a large model, use " +
    "search-design or get-properties group-by instead of browsing recursively.",
  inputSchema: {
    type: "object",
    properties: {
      dbId: { type: "number", description: "Node to browse from. Omit to start at the model root." },
      maxChildren: { type: "number", description: `Max children to return (1..${MAX_ITEMS}).` },
    },
    additionalProperties: false,
  },
  run: (args) =>
    hierarchyStep(args.dbId ?? rootDbId(), clamp(args.maxChildren ?? MAX_ITEMS, 1, MAX_ITEMS)),
};
