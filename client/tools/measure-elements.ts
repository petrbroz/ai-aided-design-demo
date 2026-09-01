import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import type { Axis } from "../viewer.js";
import { nodeName, resolveDbIds, units, worldBox } from "../viewer.js";
import { cap, MAX_ITEMS, round } from "../utils.js";

const AXES: Axis[] = ["x", "y", "z"];

const corner = (v: any) => [round(v.x), round(v.y), round(v.z)];

// getSize/getCenter allocate their own result vector when the optional target is
// omitted, so nothing here has to name a vector type.
function boxSummary(box: any) {
  const size = box.getSize();
  return {
    min: corner(box.min),
    max: corner(box.max),
    center: corner(box.getCenter()),
    dimensions: { x: round(size.x), y: round(size.y), z: round(size.z) },
    volume: round(size.x * size.y * size.z, 4),
  };
}

/** Signed gap between two boxes on one axis; 0 when they overlap on it. */
function gap(a: any, b: any, axis: Axis): number {
  if (a.max[axis] < b.min[axis]) return round(b.min[axis] - a.max[axis]);
  if (b.max[axis] < a.min[axis]) return round(a.min[axis] - b.max[axis]);
  return 0;
}

function measureElements(dbIdsInput: number[] | undefined, perObject: boolean) {
  const { dbIds, source } = resolveDbIds(dbIdsInput);

  const found = dbIds
    .map((dbId) => ({ dbId, box: worldBox(dbId) }))
    .filter(({ box }) => !box.isEmpty());
  if (found.length === 0) throw new Error("No geometry found for the given object(s).");

  const combined = new Autodesk.Viewing.Math.Box3();
  for (const { box } of found) combined.union(box);

  const result: Record<string, unknown> = {
    approximate: true,
    units: units(),
    dbIdSource: source,
    objectCount: dbIds.length,
    missingGeometry: dbIds.length - found.length,
    boundingBox: boxSummary(combined),
  };

  // Exactly two objects is the "how far apart are these?" question, so answer it
  // without making the caller pick a different tool for it.
  if (found.length === 2) {
    const [a, b] = found;
    const ca = a.box.getCenter();
    const cb = b.box.getCenter();
    result.pair = {
      centerDistance: round(ca.distanceTo(cb)),
      closestGapPerAxis: Object.fromEntries(AXES.map((ax) => [ax, gap(a.box, b.box, ax)])),
    };
  }

  if (perObject || found.length === 2) {
    result.perObject = cap(found, ({ dbId, box }) => ({
      dbId,
      name: nodeName(dbId),
      ...boxSummary(box),
    }));
  }

  return result;
}

export const measureElementsTool: ToolSpec = {
  name: "measure-elements",
  description:
    "World-space axis-aligned bounding boxes: min/max corners, center, per-axis " +
    "dimensions and box volume, merged across every object given, plus the raw " +
    "corners needed for camera framing or section placement. Pass exactly two dbIds " +
    "and it also returns `pair` — the centre-to-centre distance and the closest gap " +
    "per axis (0 means they overlap on that axis). Approximate by construction: " +
    "these are bounding boxes, not snapped geometry, so use them for scale and " +
    "clearance sanity checks, not for fabrication. If dbIds is omitted, the current " +
    "selection is used, and if nothing is selected, the whole model.",
  inputSchema: {
    type: "object",
    properties: {
      dbIds: numberArray("Objects to measure. Omit to use the current selection."),
      perObject: {
        type: "boolean",
        description: `Also return one box per object, not just the merged one (max ${MAX_ITEMS}).`,
      },
    },
    additionalProperties: false,
  },
  run: (args) => measureElements(args.dbIds, args.perObject === true),
};
