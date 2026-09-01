import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import type { Axis } from "../viewer.js";
import { nodeName, requireViewer, units, worldBox } from "../viewer.js";
import { round } from "../utils.js";

function boxSummary(dbId: number, box: any) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    dbId,
    name: nodeName(dbId),
    dimensions: { x: round(size.x), y: round(size.y), z: round(size.z) },
    center: [round(center.x), round(center.y), round(center.z)],
    volumeOfBoundingBox: round(size.x * size.y * size.z, 4),
  };
}

function measureElements(dbIds: number[]) {
  requireViewer();
  if (dbIds.length < 1 || dbIds.length > 2) {
    return { error: "Provide 1 dbId (size of one object) or 2 dbIds (distance between two)." };
  }

  const boxes = dbIds.map((dbId) => ({ dbId, box: worldBox(dbId) }));
  const empty = boxes.filter(({ box }) => box.isEmpty());
  if (empty.length > 0) {
    return {
      error: `No geometry found for dbId(s): ${empty.map((e) => e.dbId).join(", ")}.`,
      approximate: true,
    };
  }

  if (boxes.length === 1) {
    console.log(`measure-elements: size of ${nodeName(dbIds[0])}`);
    return { approximate: true, units: units(), ...boxSummary(boxes[0].dbId, boxes[0].box) };
  }

  const [a, b] = boxes;
  const ca = a.box.getCenter(new THREE.Vector3());
  const cb = b.box.getCenter(new THREE.Vector3());
  const gap = (axis: Axis) => {
    if (a.box.max[axis] < b.box.min[axis]) return round(b.box.min[axis] - a.box.max[axis]);
    if (b.box.max[axis] < a.box.min[axis]) return round(a.box.min[axis] - b.box.max[axis]);
    return 0; // overlapping on this axis
  };

  console.log(`measure-elements: ${nodeName(a.dbId)} ↔ ${nodeName(b.dbId)}`);
  return {
    approximate: true,
    units: units(),
    centerDistance: round(ca.distanceTo(cb)),
    closestGapPerAxis: { x: gap("x"), y: gap("y"), z: gap("z") },
    dimensions: [boxSummary(a.dbId, a.box), boxSummary(b.dbId, b.box)],
  };
}

export const measureElementsTool: ToolSpec = {
  name: "measure-elements",
  description:
    "Approximate measurements derived from world bounding boxes, not snapped " +
    "geometric measurements. Use for scale and clearance sanity checks, not for " +
    "fabrication. One dbId returns that object's bounding-box dimensions, centre and " +
    "box volume; two dbIds return the centre-to-centre distance and the closest gap " +
    "per axis (0 means the boxes overlap on that axis). Every result is flagged " +
    '"approximate": true and carries the model\'s unit string.',
  inputSchema: {
    type: "object",
    properties: { dbIds: numberArray("One dbId for a size, two for a distance.") },
    required: ["dbIds"],
    additionalProperties: false,
  },
  run: (args) => measureElements(args.dbIds),
};
