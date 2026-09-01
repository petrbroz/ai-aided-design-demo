import type { ToolSpec } from "../webmcp.js";
import type { Axis } from "../viewer.js";
import { requireViewer, units } from "../viewer.js";
import { clamp, round } from "../utils.js";

function clearSection() {
  requireViewer().setCutPlanes([]);
  console.log("set-section: cleared");
  return { cleared: true, cutPlanes: 0 };
}

function setSection(axis: Axis, offset: number, flip: boolean) {
  const viewer = requireViewer();
  const bbox = viewer.model.getBoundingBox();
  const t = clamp(offset, 0, 1);
  const pos = bbox.min[axis] + (bbox.max[axis] - bbox.min[axis]) * t;

  // Plane n·p + d = 0, with n the (possibly flipped) unit axis and p the cut point.
  const sign = flip ? -1 : 1;
  const nx = axis === "x" ? sign : 0;
  const ny = axis === "y" ? sign : 0;
  const nz = axis === "z" ? sign : 0;
  const d = -sign * pos;
  viewer.setCutPlanes([new THREE.Vector4(nx, ny, nz, d)]);

  console.log(`set-section: ${axis} @ ${round(pos, 2)} ${units()}${flip ? " (flipped)" : ""}`);

  return {
    axis,
    offset: t,
    worldCoordinate: round(pos, 4),
    flip,
    plane: [round(nx), round(ny), round(nz), round(d, 4)],
    units: units(),
  };
}

export const setSectionTool: ToolSpec = {
  name: "set-section",
  description:
    "Cut the model with a single section plane along a world axis. `offset` is " +
    "normalized 0..1 across the model's bounding box on that axis (0.5 = halfway), " +
    "so no world coordinates are needed. `flip` reverses which side is kept. " +
    "`clear: true` removes all cut planes. Returns the plane, the world coordinate " +
    "the cut landed on, and the model's unit string.",
  inputSchema: {
    type: "object",
    properties: {
      axis: { type: "string", enum: ["x", "y", "z"] },
      offset: {
        type: "number",
        description: "0..1 across the bounding box on that axis. 0.5 is halfway.",
      },
      flip: { type: "boolean", description: "Keep the other side instead." },
      clear: { type: "boolean", description: "Remove all cut planes." },
    },
    additionalProperties: false,
  },
  run: (args) =>
    args.clear === true ? clearSection() : setSection(args.axis, args.offset, args.flip === true),
};
