import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import { requireViewer } from "../viewer.js";
import { cap } from "../utils.js";

type VisibilityMode = "isolate" | "show" | "hide" | "reset";

const MODES: VisibilityMode[] = ["isolate", "show", "hide", "reset"];

function setVisibility(mode: VisibilityMode, dbIds: number[]) {
  const viewer = requireViewer();

  if (mode !== "reset" && dbIds.length === 0) {
    dbIds = viewer.getSelection() ?? [];
    if (dbIds.length === 0) {
      return { error: `Mode "${mode}" needs dbIds (or a non-empty selection).` };
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

  // Animated transition, not an instant jump — the human sees the agent's focus move.
  if (mode === "reset") {
    viewer.fitToView();
  } else {
    viewer.select(dbIds);
    viewer.fitToView(dbIds);
  }

  console.log(`set-visibility: ${mode} (${mode === "reset" ? "all" : dbIds.length} objects)`);

  return {
    mode,
    affected: mode === "reset" ? 0 : dbIds.length,
    isolated: cap<number>(viewer.getIsolatedNodes() ?? []),
    hidden: cap<number>(viewer.getHiddenNodes() ?? []),
  };
}

export const setVisibilityTool: ToolSpec = {
  name: "set-visibility",
  description:
    "Change what is visible in the viewer: isolate, show, hide, or reset. The camera " +
    "also selects and frames the objects with an animated transition, so the human " +
    "sees where the agent is looking. 'reset' clears isolation and shows everything.",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: MODES },
      dbIds: numberArray("Objects to act on. Omit to use the current selection."),
    },
    required: ["mode"],
    additionalProperties: false,
  },
  run: (args) => setVisibility(args.mode, args.dbIds ?? []),
};
