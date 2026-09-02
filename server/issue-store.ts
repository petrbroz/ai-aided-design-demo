import { CURRENT_USER } from "../shared/issues.ts";
import type { Issue, IssueDraft } from "../shared/issues.ts";

const MAX_ISSUES = 200;
const issues = new Map<string, Issue>();
let nextId = 1;

export function createIssue(urn: string, draft: IssueDraft): Issue {
  const issue: Issue = {
    ...draft,
    id: `ISS-${nextId++}`,
    urn,
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: CURRENT_USER,
  };
  issues.set(issue.id, issue);
  while (issues.size > MAX_ISSUES) {
    issues.delete(issues.keys().next().value!);
  }
  return issue;
}

/** Newest first. `urn` null means every design. */
export function listIssues(urn: string | null): Issue[] {
  const all = [...issues.values()].reverse();
  return urn ? all.filter((issue) => issue.urn === urn) : all;
}
