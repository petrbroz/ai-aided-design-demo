import type { ToolSpec } from "../webmcp.js";
import {
  getLegend,
  getModelName,
  isThemingActive,
  requireViewer,
  toNamed,
  units,
} from "../viewer.js";
import { cap, MAX_ITEMS, round } from "../utils.js";

function getViewState() {
  const viewer = requireViewer();
  const camera = viewer.getCamera();
  const target = viewer.navigation?.getTarget?.() ?? camera.target;
  const vec = (p: any) => (p ? [round(p.x), round(p.y), round(p.z)] : null);

  return {
    model: getModelName(),
    selection: cap(viewer.getSelection() ?? [], toNamed),
    isolated: cap<number>(viewer.getIsolatedNodes() ?? []),
    hidden: cap<number>(viewer.getHiddenNodes() ?? []),
    cutPlanes: (viewer.getCutPlanes() ?? []).length,
    themingActive: isThemingActive(),
    legend: getLegend(),
    camera: {
      position: vec(camera.position),
      target: vec(target),
      up: vec(camera.up),
    },
    units: units(),
  };
}

export const getViewStateTool: ToolSpec = {
  name: "get-view-state",
  description:
    "Report what the human is currently looking at in the CAD viewer: model name, " +
    "current selection, isolated and hidden objects, active cut planes, whether " +
    "colour theming is on, the camera, and the model's unit string. Call this first " +
    "when the user says 'this', 'these', or 'what am I looking at'. Lists are capped " +
    `at ${MAX_ITEMS} entries; the true totals are always reported.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: () => getViewState(),
};
