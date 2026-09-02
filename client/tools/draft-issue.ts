import type { ToolSpec } from "../webmcp.js";
import { vec3 } from "../webmcp.js";
import { ASSIGNEES, ISSUE_TYPES, SEVERITIES } from "../issue-schema.js";
import type { Camera, IssueDraft } from "../issue-schema.js";
import { getSelection, nodeName, readViewpoint } from "../viewer.js";
import * as issues from "../issues.js";

type CameraInput = Partial<Camera> & Pick<Camera, "position" | "target">;

interface DraftIssueInput {
  title?: string;
  description?: string;
  type?: string;
  severity?: string;
  assignedTo?: string;
  dueDate?: string;
  dbId?: number;
  camera?: CameraInput;
  reset?: boolean;
  recapture?: boolean;
}

function draftIssue(input: DraftIssueInput) {
  if (input.reset === true) issues.resetDraft();
  const current = issues.getDraft();
  const patch: Partial<IssueDraft> = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.type !== undefined) patch.type = input.type;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;

  const wantsCapture = input.recapture === true;

  if (input.dbId !== undefined) {
    patch.element = { dbId: input.dbId, name: nodeName(input.dbId) };
  } else if (current.element === null || wantsCapture) {
    const [dbId] = getSelection();
    if (dbId !== undefined) patch.element = { dbId, name: nodeName(dbId) };
  }

  // The viewpoint is the whole view, not just the eye: cut planes and the isolated or
  // hidden sets are usually the only reason the problem is visible, so they are stored
  // with it. An explicit `camera` replaces the eye within the live view rather than
  // standing alone — the agent picks the shot, the screen supplies the rest of the state.
  if (input.camera !== undefined) {
    // An agent naming a viewpoint knows where to stand and what to look at, not which
    // way is up — filling those from the live camera beats rejecting the call.
    const live = readViewpoint();
    patch.viewpoint = {
      ...live,
      camera: {
        position: input.camera.position,
        target: input.camera.target,
        up: input.camera.up ?? live.camera.up,
        fov: input.camera.fov ?? live.camera.fov,
      },
    };
  } else if (current.viewpoint === null || wantsCapture) {
    patch.viewpoint = readViewpoint();
  }

  const draft = issues.patchDraft(patch);
  const missing = issues.draftGaps();

  return {
    draft,
    missing,
    ready: missing.length === 0,
    note:
      missing.length === 0
        ? "The draft is on screen for the user to review. Call submit-issue once they approve it."
        : `Ask the user for: ${missing.join(", ")}.`,
  };
}

export const draftIssueTool: ToolSpec = {
  name: "draft-issue",
  description:
    "Fill in the new-issue form the user can see, without submitting it. Call it to " +
    "start a draft and again to revise one — every field you omit keeps its current " +
    "value, so 'change the severity to high' is a single-field call. The element and " +
    "the viewpoint are captured from the viewer automatically when the draft does not " +
    "have them yet: draft the issue while the user is still looking at the thing they " +
    "are complaining about. The viewpoint is the entire view state — camera, section " +
    "planes, and the isolated, hidden and selected sets — so show-issue can put the " +
    "screen back exactly as it was, cutaway and all. Pass `recapture: true` to re-take " +
    "element and viewpoint from the current view, or `reset: true` to discard the draft " +
    "and start a new one. " +
    "Returns the resulting draft and `missing` — the fields still required before it " +
    "can be submitted. Always read the draft back to the user and let them approve it; " +
    "submit-issue is a separate step on purpose.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "One-line summary of the problem." },
      description: {
        type: "string",
        description: "What is wrong and what it should be instead, including measured values.",
      },
      type: { type: "string", enum: [...ISSUE_TYPES] },
      severity: { type: "string", enum: [...SEVERITIES] },
      assignedTo: { type: "string", enum: [...ASSIGNEES] },
      dueDate: { type: "string", description: "YYYY-MM-DD, or an empty string to clear it." },
      dbId: {
        type: "number",
        description: "Element the issue is about. Omit to use the current selection.",
      },
      camera: {
        type: "object",
        properties: {
          position: vec3("World-space camera (eye) position."),
          target: vec3("World-space point the camera looks at."),
          up: vec3("Camera up direction. Omit to use the current one."),
          fov: { type: "number", description: "Vertical field of view in degrees. Omit to use the current one." },
        },
        required: ["position", "target"],
        additionalProperties: false,
        description:
          "Eye position to store instead of the live camera. The rest of the view state " +
          "(section planes, visibility, selection) is always taken from the screen. " +
          "Omit to store the current camera too.",
      },
      reset: { type: "boolean", description: "Discard the current draft before applying this one." },
      recapture: {
        type: "boolean",
        description: "Re-read the element and the whole viewpoint from the live viewer even if already set.",
      },
    },
    additionalProperties: false,
  },
  run: (args) => draftIssue(args),
};
