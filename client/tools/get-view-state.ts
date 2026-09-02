import type { ToolSpec } from "../webmcp.js";
import { readViewState } from "../viewer.js";

export const getViewStateTool: ToolSpec = {
  name: "get-view-state",
  description:
    "What the user is currently looking at: model, units, selection, isolated and " +
    "hidden objects, active section planes, the colour-coding applied by " +
    "set-theming-color, and the camera. Call this first when the " +
    "user says 'this', 'these', or 'what am I looking at' — and to read the camera " +
    "before raising an issue about what is on screen.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: () => readViewState(),
};
