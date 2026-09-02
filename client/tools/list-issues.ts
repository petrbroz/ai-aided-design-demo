import type { ToolSpec } from "../webmcp.js";
import { ASSIGNEES, SEVERITIES, STATUSES } from "../issue-schema.js";
import * as issues from "../issues.js";
import { cap, MAX_ITEMS } from "../utils.js";

interface ListIssuesInput {
  status?: string;
  severity?: string;
  assignedTo?: string;
}

function listIssues(input: ListIssuesInput) {
  const matching = issues.getIssues().filter(
    (issue) =>
      (input.status === undefined || issue.status === input.status) &&
      (input.severity === undefined || issue.severity === input.severity) &&
      (input.assignedTo === undefined || issue.assignedTo === input.assignedTo)
  );

  return {
    filters: input,
    issues: cap(matching, (issue) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      type: issue.type,
      severity: issue.severity,
      status: issue.status,
      assignedTo: issue.assignedTo,
      dueDate: issue.dueDate || null,
      element: issue.element,
      createdAt: issue.createdAt,
      createdBy: issue.createdBy,
    })),
  };
}

export const listIssuesTool: ToolSpec = {
  name: "list-issues",
  description:
    "The issues already raised against the design on screen, newest first. Optional " +
    "`status`, `severity` and `assignedTo` filters narrow it. Each issue carries the " +
    "element it was raised against, so this is how you answer 'has anyone already " +
    "reported this?' before drafting a duplicate. Use show-issue to navigate to one. " +
    `At most ${MAX_ITEMS} are returned; the true total is always reported.`,
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: [...STATUSES] },
      severity: { type: "string", enum: [...SEVERITIES] },
      assignedTo: { type: "string", enum: [...ASSIGNEES] },
    },
    additionalProperties: false,
  },
  run: (args) => listIssues(args),
};
