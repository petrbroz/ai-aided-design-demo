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

/** A camera an agent named: it knows where to stand and what to look at, not much else. */
export type CameraInput = Partial<Camera> & Pick<Camera, "position" | "target">;

/** One theming colour and the objects wearing it. `color` is canonical `#rrggbb`. */
export interface ThemingGroup {
  color: string;
  /** 0..1 blend with the object's own material. */
  intensity: number;
  dbIds: number[];
}

/**
 * The viewer's own state object, the thing `Viewer3D#getState` produces and
 * `restoreState` consumes. Only the handful of fields this app reads back for display are
 * named; everything else — autocam, render options, explode scale, whatever the loaded
 * extensions inject — rides along untyped and is handed straight back to the viewer.
 */
export interface ViewerState {
  viewport?: {
    eye?: number[];
    target?: number[];
    up?: number[];
    pivotPoint?: number[];
    fieldOfView?: number;
    [key: string]: unknown;
  };
  /** One entry per visible model, so one: this app shows a single design at a time. */
  objectSet?: Array<{
    /** The selection — `id` is the viewer state schema's name for it, not ours. */
    id?: number[];
    isolated?: number[];
    hidden?: number[];
    [key: string]: unknown;
  }>;
  cutplanes?: number[][];
  [key: string]: unknown;
}

/**
 * Everything needed to put the viewer back the way it was when the issue was raised — not
 * just where the camera stood. A cut plane, an isolated floor or a hidden ceiling is
 * often the only reason the problem was visible at all, so the whole state travels with
 * the issue, and it travels in the viewer's own format: saving and restoring are the
 * SDK's `getState` and `restoreState`, not a hand-picked subset of them that quietly
 * drops whatever nobody thought to copy across.
 */
export interface Viewpoint {
  state: ViewerState;
  /**
   * Colour-coding is often the whole point of the view — "these three rooms are the
   * wrong type" only reads as an issue while the types are painted. It sits beside the
   * viewer state rather than inside it because the state has no field for theming
   * colours; `viewer.ts` keeps the record this comes from. Optional because issues
   * stored before set-theming-color existed do not carry it, and an absent list restores
   * to no colour-coding, same as an empty one.
   */
  theming?: ThemingGroup[];
}

/** The stored selection, which callers fall back off of when it is empty. */
export function viewpointSelection(viewpoint: Viewpoint): number[] {
  return viewpoint.state.objectSet?.[0]?.id ?? [];
}

/** Eye position and set sizes — all the panel's chip and show-issue's report need. */
export function summarizeViewpoint(viewpoint: Viewpoint) {
  const objects = viewpoint.state.objectSet?.[0];
  return {
    eye: viewpoint.state.viewport?.eye ?? null,
    selection: objects?.id?.length ?? 0,
    isolated: objects?.isolated?.length ?? 0,
    hidden: objects?.hidden?.length ?? 0,
    cutPlanes: viewpoint.state.cutplanes?.length ?? 0,
    theming: viewpoint.theming?.length ?? 0,
  };
}

/**
 * A draft or issue as a tool result, with the viewpoint reduced to its summary. The
 * viewer state is for the viewer, not for the agent: it is a page of numbers nothing
 * acts on, and its isolated and hidden sets are uncapped.
 */
export function withViewpointSummary<T extends { viewpoint: Viewpoint | null }>(issue: T) {
  return { ...issue, viewpoint: issue.viewpoint ? summarizeViewpoint(issue.viewpoint) : null };
}

/** A copy with the selection replaced, for an issue whose element outlived its selection. */
export function withSelection(viewpoint: Viewpoint, dbIds: number[]): Viewpoint {
  const objectSet = viewpoint.state.objectSet ?? [{ idType: "lmv" }];
  return {
    ...viewpoint,
    state: {
      ...viewpoint.state,
      objectSet: objectSet.map((set, i) => (i === 0 ? { ...set, id: dbIds } : set)),
    },
  };
}

/**
 * A copy with the eye replaced, for an agent that names a shot instead of taking the live
 * one. The pivot follows the new target: left where the live camera had it, the first
 * orbit after restoring would turn around a point nowhere near what the shot is of.
 */
export function withCamera(viewpoint: Viewpoint, camera: CameraInput): Viewpoint {
  const viewport = viewpoint.state.viewport ?? {};
  return {
    ...viewpoint,
    state: {
      ...viewpoint.state,
      viewport: {
        ...viewport,
        eye: camera.position,
        target: camera.target,
        pivotPoint: camera.target,
        // An agent knows where to stand and what to look at, not which way is up —
        // keeping the live values for those beats rejecting the call.
        up: camera.up ?? viewport.up,
        fieldOfView: camera.fov ?? viewport.fieldOfView,
      },
    },
  };
}

/** The shape viewpoints had before they were stored as viewer state objects. */
interface LegacyViewpoint {
  camera: Camera;
  cutPlanes: number[][];
  isolated: number[];
  hidden: number[];
  selection: number[];
  theming?: ThemingGroup[];
}

/**
 * Issues live in IndexedDB and so outlive the code that wrote them. A viewpoint stored
 * before it was a viewer state object is converted on its way out of the store, which is
 * the only place the old shape is known: everything downstream sees one format.
 */
export function normalizeViewpoint(
  viewpoint: Viewpoint | LegacyViewpoint | null | undefined
): Viewpoint | null {
  if (!viewpoint) return null;
  if ("state" in viewpoint) return viewpoint;

  const { camera } = viewpoint;
  if (!camera) return null;

  return {
    state: {
      version: "2.0",
      viewport: {
        eye: camera.position,
        target: camera.target,
        up: camera.up,
        pivotPoint: camera.target,
        fieldOfView: camera.fov,
      },
      objectSet: [
        {
          id: viewpoint.selection,
          isolated: viewpoint.isolated,
          hidden: viewpoint.hidden,
          idType: "lmv",
        },
      ],
      cutplanes: viewpoint.cutPlanes,
    },
    theming: viewpoint.theming,
  };
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
  if (!draft.viewpoint || !Array.isArray(draft.viewpoint.state?.viewport?.eye)) missing.push("viewpoint");

  return missing;
}
