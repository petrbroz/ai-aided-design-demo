// In the order an agent needs it: look, inspect, change, then read and write issues.

import type { ToolSpec } from "../webmcp.js";
import { getViewStateTool } from "./get-view-state.js";
import { browseHierarchyTool } from "./browse-hierarchy.js";
import { getPropertiesTool } from "./get-properties.js";
import { measureElementsTool } from "./measure-elements.js";
import { setViewStateTool } from "./set-view-state.js";
import { captureViewportTool } from "./capture-viewport.js";
import { listIssuesTool } from "./list-issues.js";
import { showIssueTool } from "./show-issue.js";
import { draftIssueTool } from "./draft-issue.js";
import { submitIssueTool } from "./submit-issue.js";

export const TOOLS: ToolSpec[] = [
  getViewStateTool,
  browseHierarchyTool,
  getPropertiesTool,
  measureElementsTool,
  setViewStateTool,
  captureViewportTool,
  listIssuesTool,
  showIssueTool,
  draftIssueTool,
  submitIssueTool,
];
