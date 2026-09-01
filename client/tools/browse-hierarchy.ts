import type { ToolSpec } from "../webmcp.js";
import { ancestryOf, hierarchyStep, rootDbId } from "../viewer.js";
import { cap, clamp, MAX_ITEMS } from "../utils.js";

function browseHierarchy(dbId: number | undefined, maxChildren: number) {
  const id = dbId ?? rootDbId();
  const limit = clamp(maxChildren, 1, MAX_ITEMS);

  const { node, parent, children } = hierarchyStep(id);

  return {
    dbId: node.dbId,
    name: node.name,
    isLeaf: node.isLeaf,
    parent,
    ancestors: ancestryOf(id),
    children: cap(children, undefined, limit),
  };
}

export const browseHierarchyTool: ToolSpec = {
  name: "browse-hierarchy",
  description:
    "Walk the design's logical hierarchy (the InstanceTree) one level at a time — " +
    "the same tree the model browser shows, e.g. model > levels > categories > " +
    "families > instances. Omit dbId to start at the model root. Returns the node's " +
    "name, its parent, the breadcrumb of ancestors back to the root, and its " +
    "immediate children, each flagged `isLeaf` so the agent knows whether it can " +
    "descend further. Call again with a child's dbId to go deeper, or the parent's " +
    `dbId to go back up. Children are capped at ${MAX_ITEMS} by default; use ` +
    "search-design or get-properties (group-by) instead of deep recursive browsing " +
    "to find specific objects across a large model.",
  inputSchema: {
    type: "object",
    properties: {
      dbId: { type: "number", description: "Node to browse from. Omit to start at the model root." },
      maxChildren: { type: "number", description: `Max children to return (1..${MAX_ITEMS}).` },
    },
    additionalProperties: false,
  },
  run: (args) => browseHierarchy(args.dbId, args.maxChildren ?? MAX_ITEMS),
};
