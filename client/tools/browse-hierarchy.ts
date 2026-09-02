import type { ToolSpec } from "../webmcp.js";
import { ancestorPath, childCount, childDbIds, nodeName, rootDbId } from "../viewer.js";
import type { Capped } from "../utils.js";
import { cap, clamp, MAX_ITEMS } from "../utils.js";

// Revit's own structure, which is what the object tree of an .rvt translation is. The
// depth of a node in the tree *is* its kind, so the label is derived, never read from
// the node — anything deeper than an instance is geometry inside one.
const ROLES = ["model", "category", "family", "type", "instance"];
const role = (depth: number) => ROLES[depth] ?? "sub-element";

const MAX_DEPTH = 3;

// Levels multiply: three levels at 50 each would be 125,000 nodes in one reply. The cap
// per level bounds the fan-out the agent sees; this bounds what the whole reply costs.
const NODE_BUDGET = 4 * MAX_ITEMS;

interface HierarchyNode {
  dbId: number;
  name: string;
  role: string;
  childCount: number;
  children?: Capped<HierarchyNode>;
}

interface BrowseHierarchyInput {
  dbId?: number;
  depth?: number;
  nameFilter?: string;
}

function browseHierarchy(input: BrowseHierarchyInput) {
  const root = rootDbId();
  const startId = input.dbId ?? root;
  const path = ancestorPath(startId);
  if (path[0] !== root) {
    throw new Error(`dbId ${startId} is not a node in this model's object tree.`);
  }

  const depth = clamp(Math.floor(input.depth ?? 1), 1, MAX_DEPTH);
  const filter = input.nameFilter?.trim().toLowerCase() || undefined;

  let budget = NODE_BUDGET;

  const expand = (
    dbId: number,
    nodeDepth: number,
    levels: number,
    filtered: boolean
  ): Capped<HierarchyNode> => {
    const children = childDbIds(dbId).map((id) => ({ dbId: id, name: nodeName(id) }));
    const matched =
      filtered && filter ? children.filter((c) => c.name.toLowerCase().includes(filter)) : children;

    // `total` stays the true count even when the budget is what cut the list short, so a
    // partial answer never reads as a complete one.
    const page = cap(matched, undefined, Math.max(0, Math.min(MAX_ITEMS, budget)));
    budget -= page.returned;

    return {
      ...page,
      items: page.items.map((child) => {
        const count = childCount(child.dbId);
        return {
          ...child,
          role: role(nodeDepth + 1),
          childCount: count,
          ...(levels > 1 && count > 0 && budget > 0
            ? { children: expand(child.dbId, nodeDepth + 1, levels - 1, false) }
            : {}),
        };
      }),
    };
  };

  const startDepth = path.length - 1;
  const children = expand(startId, startDepth, depth, true);

  return {
    node: {
      dbId: startId,
      name: nodeName(startId),
      role: role(startDepth),
      // The count before any filter, so "18 of 18 categories matched" is checkable.
      childCount: childCount(startId),
    },
    // Root → parent. A type node's `childCount` here is how many instances that type has,
    // which is the whole of "are there others like this one?" in a single call.
    ancestors: path.slice(0, -1).map((id, i) => ({
      dbId: id,
      name: nodeName(id),
      role: role(i),
      childCount: childCount(id),
    })),
    nameFilter: filter ?? null,
    depth,
    budgetExhausted: budget <= 0,
    children,
  };
}

export const browseHierarchyTool: ToolSpec = {
  name: "browse-hierarchy",
  description:
    "Browse the design's logical hierarchy one level at a time. The model is Revit, so " +
    "the levels are model → category ('Doors') → family ('M_Single flush') → type " +
    "('915x2135mm') → instance, and every node carries its `role` and its `childCount`. " +
    "Omit `dbId` to list the categories. Pass the dbId of a selected object and the " +
    "`ancestors` chain tells you which category, family and type it belongs to, with the " +
    "type's `childCount` being how many instances of it exist — so 'are there other " +
    "doors of this type?' is one call, and listing them is a second call on the type's " +
    "dbId. Use this to turn a name into dbIds before calling get-properties or " +
    "set-view-state, rather than guessing ids. Structure only: no properties, no " +
    "geometry. Each level is capped and reports the true total, and a whole reply is " +
    `capped at ${NODE_BUDGET} nodes — expand a branch instead of raising \`depth\`.`,
  inputSchema: {
    type: "object",
    properties: {
      dbId: {
        type: "number",
        description: "Node to list the children of. Omit for the model root (the categories).",
      },
      depth: {
        type: "number",
        description: `How many levels below the node to expand, 1..${MAX_DEPTH}. Default 1.`,
      },
      nameFilter: {
        type: "string",
        description:
          "Case-insensitive substring match, applied to the node's direct children only.",
      },
    },
    additionalProperties: false,
  },
  run: (args) => browseHierarchy(args),
};
