import type { ToolSpec } from "../webmcp.js";
import { readViewState, selectAndFocus } from "../viewer.js";
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
  if (!issue.camera) throw new Error(`${issue.id} has no stored viewpoint to navigate to.`);

  selectAndFocus(issue.camera, issue.element ? [issue.element.dbId] : []);
  return { shown: issue, ...readViewState() };
}

export const showIssueTool: ToolSpec = {
  name: "show-issue",
  description:
    "Navigate to an existing issue: jump the camera to the viewpoint it was raised " +
    "from and re-select the element it is about. Use it for 'take me to ISS-2' or " +
    "'show me the one Priya raised'. Get the id from list-issues. Returns the issue " +
    "and the resulting view state.",
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
