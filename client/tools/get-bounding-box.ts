import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import { nodeName, resolveDbIds, units, worldBox } from "../viewer.js";
import { cap, MAX_ITEMS, round } from "../utils.js";

function corner(v: any) {
  return [round(v.x), round(v.y), round(v.z)];
}

function boxSummary(box: any) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: corner(box.min),
    max: corner(box.max),
    center: corner(center),
    dimensions: { x: round(size.x), y: round(size.y), z: round(size.z) },
  };
}

function getBoundingBox(dbIdsInput: number[] | undefined, perObject: boolean) {
  const { dbIds, source } = resolveDbIds(dbIdsInput);
  if (dbIds.length === 0) return { error: "No objects to measure." };

  const boxes = dbIds.map((dbId) => ({ dbId, box: worldBox(dbId) }));
  const found = boxes.filter(({ box }) => !box.isEmpty());
  if (found.length === 0) {
    return { error: "No geometry found for the given object(s).", dbIdSource: source };
  }

  const combined = new THREE.Box3();
  for (const { box } of found) combined.union(box);

  console.log(
    `get-bounding-box: ${dbIds.length === 1 ? nodeName(dbIds[0]) : `${dbIds.length} objects`}`
  );

  const result: Record<string, unknown> = {
    dbIdSource: source,
    objectCount: dbIds.length,
    missingGeometry: dbIds.length - found.length,
    units: units(),
    boundingBox: boxSummary(combined),
  };

  if (perObject) {
    result.perObject = cap(found, ({ dbId, box }) => ({ dbId, name: nodeName(dbId), ...boxSummary(box) }));
  }

  return result;
}

export const getBoundingBoxTool: ToolSpec = {
  name: "get-bounding-box",
  description:
    "World-space axis-aligned bounding box for one or more elements, merged into a " +
    "single box: min/max corners, center, and per-axis dimensions. Unlike " +
    "measure-elements (which compares sizes/distances for 1-2 objects), this exposes " +
    "the raw min/max corners needed for camera framing, section-box placement, or " +
    "other world-space math, and scales to any number of dbIds. If dbIds is omitted, " +
    "the current selection is used, and if nothing is selected, the whole model. Set " +
    "`perObject: true` to also get one box per input object (capped at " +
    `${MAX_ITEMS}). Objects with no geometry are excluded from the combined box and ` +
    "counted in `missingGeometry`.",
  inputSchema: {
    type: "object",
    properties: {
      dbIds: numberArray(
        "Objects to measure. Omit to use the current selection, or the whole model if nothing is selected."
      ),
      perObject: {
        type: "boolean",
        description: "Also return an individual box per dbId, not just the combined box.",
      },
    },
    additionalProperties: false,
  },
  run: (args) => getBoundingBox(args.dbIds, args.perObject === true),
};
