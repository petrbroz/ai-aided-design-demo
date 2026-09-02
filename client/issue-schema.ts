export const ISSUE_TYPES = [
  "Design",
  "Clash / Coordination",
  "Dimensional",
  "Code Compliance",
  "Constructability",
  "Quality",
  "Safety",
] as const;

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const STATUSES = ["open", "in-review", "resolved", "closed"] as const;

export const ASSIGNEES = [
  "Unassigned",
  "Alex Chen — Structural",
  "Priya Raman — MEP",
  "Marta Kowalska — Architecture",
  "Tom Whitfield — Construction",
  "Yuki Tanaka — QA",
] as const;

export const CURRENT_USER = "Petr Broz";

export type IssueType = (typeof ISSUE_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];

export interface Camera {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
}

/**
 * Everything needed to put the viewer back the way it was when the issue was raised —
 * not just where the camera stood. A cut plane, an isolated floor or a hidden ceiling is
 * often the only reason the problem was visible at all, so the whole state travels with
 * the issue. Cut planes are `[nx, ny, nz, d]`, the shape set-view-state also takes.
 */
export interface Viewpoint {
  camera: Camera;
  cutPlanes: number[][];
  isolated: number[];
  hidden: number[];
  selection: number[];
}

export interface IssueElement {
  dbId: number;
  name: string;
}

export interface IssueDraft {
  title: string;
  description: string;
  type: string;
  severity: string;
  assignedTo: string;
  dueDate: string;
  element: IssueElement | null;
  viewpoint: Viewpoint | null;
}

export interface Issue extends IssueDraft {
  id: string;
  urn: string;
  status: string;
  createdAt: string;
  createdBy: string;
}

export function emptyDraft(): IssueDraft {
  return {
    title: "",
    description: "",
    type: "Design",
    severity: "medium",
    assignedTo: "Unassigned",
    dueDate: "",
    element: null,
    viewpoint: null,
  };
}

/**
 * The field names that are missing or invalid — empty means submittable. Returned rather
 * than thrown so one answer serves three callers: the server's 400, submit-issue's error,
 * and draft-issue's hint about what to ask the user for next.
 */
export function validateDraft(draft: Partial<IssueDraft> | null | undefined): string[] {
  const missing: string[] = [];
  if (!draft) return ["title", "type", "severity", "element", "viewpoint"];

  if (!draft.title || draft.title.trim() === "") missing.push("title");
  if (!ISSUE_TYPES.includes(draft.type as IssueType)) missing.push("type");
  if (!SEVERITIES.includes(draft.severity as Severity)) missing.push("severity");
  if (!draft.element || typeof draft.element.dbId !== "number") missing.push("element");
  if (!draft.viewpoint || !Array.isArray(draft.viewpoint.camera?.position)) missing.push("viewpoint");

  return missing;
}
