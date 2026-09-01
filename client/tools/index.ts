/**
 * The tool surface, in the order an agent is most likely to need it: look, find,
 * inspect, then change what is on screen.
 */

import type { ToolSpec } from "../webmcp.js";
import { getViewStateTool } from "./get-view-state.js";
import { browseHierarchyTool } from "./browse-hierarchy.js";
import { searchDesignTool } from "./search-design.js";
import { getPropertiesTool } from "./get-properties.js";
import { measureElementsTool } from "./measure-elements.js";
import { setViewStateTool } from "./set-view-state.js";
import { colorElementsTool } from "./color-elements.js";
import { captureViewportTool } from "./capture-viewport.js";

export const TOOLS: ToolSpec[] = [
  getViewStateTool,
  browseHierarchyTool,
  searchDesignTool,
  getPropertiesTool,
  measureElementsTool,
  setViewStateTool,
  colorElementsTool,
  captureViewportTool,
];
