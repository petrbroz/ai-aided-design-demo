import type { ToolSpec } from "../webmcp.js";
import type { Axis } from "../viewer.js";
import { numberArray, vec3 } from "../webmcp.js";
import { awaitCameraTransition, readViewState, requireViewer, setCameraView } from "../viewer.js";
import { clamp, round } from "../utils.js";

type VisibilityMode = "isolate" | "show" | "hide" | "reset";

const MODES: VisibilityMode[] = ["isolate", "show", "hide", "reset"];
const AXES: Axis[] = ["x", "y", "z"];

/** @param frame false when an explicit camera would otherwise be overwritten here. */
async function applyVisibility(args: { mode: VisibilityMode; dbIds?: number[] }, frame: boolean) {
  const viewer = requireViewer();
  const { mode } = args;
  let dbIds = args.dbIds ?? [];

  if (mode !== "reset" && dbIds.length === 0) {
    dbIds = viewer.getSelection() ?? [];
    if (dbIds.length === 0) {
      throw new Error(`visibility.mode "${mode}" needs dbIds (or a non-empty selection).`);
    }
  }

  switch (mode) {
    case "isolate": viewer.isolate(dbIds); break;
    case "hide": viewer.hide(dbIds); break;
    case "show": viewer.show(dbIds); break;
    case "reset":
      viewer.isolate([]);
      viewer.showAll();
      viewer.clearSelection();
      break;
  }

  // Animated, so the human sees the agent's focus move. Never frame what was just
  // hidden: that would fly the camera at empty space.
  const framed = frame && mode !== "hide";
  if (framed) {
    if (mode === "reset") viewer.fitToView();
    else {
      viewer.select(dbIds);
      viewer.fitToView(dbIds);
    }
    // Waited out, or the view state below would report a camera still in flight.
    await awaitCameraTransition();
  }

  return { mode, affected: mode === "reset" ? 0 : dbIds.length, framed };
}

function applySection(args: { axis?: unknown; offset?: unknown; flip?: boolean; clear?: boolean }) {
  const viewer = requireViewer();

  if (args.clear === true) {
    viewer.setCutPlanes([]);
    return { cleared: true };
  }

  // Cannot be schema-`required` while `clear` shares the sub-schema, so check here: a
  // bare `{}` would otherwise install a live `Vector4(0, 0, 0, NaN)` cut plane.
  const { axis, offset } = args;
  if (!AXES.includes(axis as Axis)) {
    throw new Error("`section.axis` must be one of x, y, z (or pass `section.clear: true`).");
  }
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    throw new Error("`section.offset` must be a number between 0 and 1.");
  }

  const bbox = viewer.model.getBoundingBox();
  const t = clamp(offset, 0, 1);
  const pos = bbox.min[axis as Axis] + (bbox.max[axis as Axis] - bbox.min[axis as Axis]) * t;

  // Plane n·p + d = 0, with n the (possibly flipped) unit axis and p the cut point.
  const flip = args.flip === true;
  const sign = flip ? -1 : 1;
  const normal = AXES.map((a) => (a === axis ? sign : 0));
  viewer.setCutPlanes([new Autodesk.Viewing.Math.Vector4(normal[0], normal[1], normal[2], -sign * pos)]);

  return { axis, offset: t, flip, worldCoordinate: round(pos, 4) };
}

/**
 * Applied in a fixed order — visibility, section, camera — so a call that both isolates
 * objects *and* names a camera gets the camera it asked for, not the fit-to-view.
 */
async function setViewState(args: any) {
  const { visibility, section, camera } = args;
  if (!visibility && !section && !camera) {
    throw new Error("Pass at least one of `visibility`, `section`, or `camera`.");
  }

  const applied: Record<string, unknown> = {};
  if (visibility) applied.visibility = await applyVisibility(visibility, camera === undefined);
  if (section) applied.section = applySection(section);
  if (camera) {
    await setCameraView(camera.position, camera.target, camera.up, camera.fov);
    applied.camera = { set: true };
  }

  return { applied, ...readViewState() };
}

export const setViewStateTool: ToolSpec = {
  name: "set-view-state",
  description:
    "Change what is on screen: visibility, the section plane, the camera, or any " +
    "combination of the three in one call. `visibility` isolates, shows, hides, or " +
    "resets objects — 'isolate' and 'show' also select and frame them with an " +
    "animated transition so the human sees where the agent is looking, while 'hide' " +
    "leaves the camera alone. `section` cuts the model along a world axis, with " +
    "`offset` normalized 0..1 across the bounding box on that axis (0.5 = halfway), " +
    "so no world coordinates are needed; `section.clear` removes all cut planes. " +
    "`camera` flies to an exact eye position and look-at target — use it for a " +
    "precise, reproducible shot, and `visibility` alone when you just want to " +
    "'look at' some objects; `camera` is also how you return to a viewpoint an " +
    "issue was raised from. Passing `camera` suppresses the framing animation, so " +
    "an explicit shot is never overwritten. Returns the full view state once the " +
    "camera has landed, in the same shape get-view-state reports.",
  inputSchema: {
    type: "object",
    properties: {
      visibility: {
        type: "object",
        properties: {
          mode: { type: "string", enum: MODES },
          dbIds: numberArray("Objects to act on. Omit to use the current selection."),
        },
        required: ["mode"],
        additionalProperties: false,
      },
      section: {
        type: "object",
        properties: {
          axis: { type: "string", enum: AXES },
          offset: { type: "number", description: "0..1 across the bounding box on that axis." },
          flip: { type: "boolean", description: "Keep the other side instead." },
          clear: { type: "boolean", description: "Remove all cut planes." },
        },
        additionalProperties: false,
      },
      camera: {
        type: "object",
        properties: {
          position: vec3("World-space camera (eye) position."),
          target: vec3("World-space point the camera looks at."),
          up: vec3("Camera up direction. Omit to keep the current one."),
          fov: { type: "number", description: "Vertical field of view in degrees. Omit to keep the current one." },
        },
        required: ["position", "target"],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  run: (args) => setViewState(args),
};
