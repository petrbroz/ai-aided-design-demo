import type { ToolSpec } from "../webmcp.js";
import { vec3 } from "../webmcp.js";
import { setCameraView } from "../viewer.js";

type Vec3 = [number, number, number];

function setCamera(position: Vec3, target: Vec3, up?: Vec3, fov?: number) {
  const camera = setCameraView(position, target, up, fov);
  console.log(`set-camera: position ${position} → target ${target}`);
  return camera;
}

export const setCameraTool: ToolSpec = {
  name: "set-camera",
  description:
    "Place the camera at an exact position and orientation: eye `position`, `target` " +
    "(the look-at point), and optionally `up` and vertical `fov` in degrees. Unlike " +
    "set-visibility's isolate/show/hide, which animate the camera into view, this cuts " +
    "straight to the given view with no path animation — use it for a precise, " +
    "reproducible shot rather than a 'look at this' framing. `up` and `fov` default " +
    "to whatever the camera already has. Returns the resulting camera state.",
  inputSchema: {
    type: "object",
    properties: {
      position: vec3("World-space camera (eye) position."),
      target: vec3("World-space point the camera looks at."),
      up: vec3("Camera up direction. Omit to keep the current up vector."),
      fov: { type: "number", description: "Vertical field of view, in degrees. Omit to keep the current fov." },
    },
    required: ["position", "target"],
    additionalProperties: false,
  },
  run: (args) => setCamera(args.position, args.target, args.up, args.fov),
};
