import type { ToolSpec } from "../webmcp.js";
import { readViewState, restoreViewpoint } from "../viewer.js";
import * as issues from "../issues.js";

function showIssue(id: string) {
  const issue = issues.findIssue(id);
  if (!issue) {
    const known = issues.getIssues().map((i) => i.id);
    throw new Error(
      known.length > 0
        ? `No issue "${id}" on this design. Known ids: ${known.join(", ")}.`
        : `No issue "${id}" — no issues have been raised on this design yet.`
    );
  }
  const { viewpoint, ...shown } = issue;
  if (!viewpoint) throw new Error(`${issue.id} has no stored viewpoint to navigate to.`);

  // An issue raised before anything was selected still points at an element, so fall
  // back to it rather than restoring the view with nothing highlighted in it.
  const selection =
    viewpoint.selection.length > 0
      ? undefined
      : issue.element
        ? [issue.element.dbId]
        : undefined;

  restoreViewpoint(viewpoint, selection);

  // The stored sets are uncapped and can be large; the view state below reports what
  // actually landed on screen, so counts are all the agent needs of the stored ones.
  return {
    shown,
    restored: {
      cutPlanes: viewpoint.cutPlanes.length,
      isolated: viewpoint.isolated.length,
      hidden: viewpoint.hidden.length,
      selection: viewpoint.selection.length,
    },
    ...readViewState(),
  };
}

export const showIssueTool: ToolSpec = {
  name: "show-issue",
  description:
    "Navigate to an existing issue: restore the entire view it was raised from — " +
    "camera, section planes, and which objects were isolated, hidden and selected — " +
    "so the user sees what the reporter saw, cutaway and all. Whatever is currently " +
    "hidden or cut is discarded first; this is a jump to a stored view, not a change " +
    "on top of the present one. Use it for 'take me to ISS-2' or 'show me the one " +
    "Priya raised'. Get the id from list-issues. Returns the issue, how much of the " +
    "stored view it put back, and the resulting view state.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: 'Issue id, e.g. "ISS-2".' },
    },
    required: ["id"],
    additionalProperties: false,
  },
  run: (args) => showIssue(args.id),
};
