// Viewer SDK v7.126, pinned by the page. Two v7.12x changes shape the code below:
// `getObjectTree` replaces the deprecated `getInstanceTree` (7.122), and the SDK's
// vector/box types live on `Autodesk.Viewing.Math` rather than the `THREE` global
// (7.120/7.122), where `THREE` is now only a compatibility shim.

import { withSelection } from "./issue-schema.js";
import type { ThemingGroup, Viewpoint } from "./issue-schema.js";
import { cap, json, parseHexColor, round } from "./utils.js";

export type Axis = "x" | "y" | "z";

export interface BulkProperty {
  displayName?: string;
  attributeName?: string;
  displayValue?: unknown;
  units?: string | null;
}

export interface BulkResult {
  dbId: number;
  name?: string;
  properties: BulkProperty[];
}

/* ------------------------------------------------------------------ viewer state */

let viewer: any = null;
let modelName = "(none)";

/** The viewer, or a throw the tool layer turns into `{ error }`. */
export function requireViewer(): any {
  if (!viewer || !viewer.model) throw new Error("No model is loaded yet.");
  return viewer;
}

export function getModelName(): string {
  return modelName;
}

/* ------------------------------------------------------------------- lifecycle */

export async function initViewer(host: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => {
    Autodesk.Viewing.Initializer(
      {
        env: "AutodeskProduction2",
        api: "streamingV2",
        getAccessToken: async (cb: (token: string, expires: number) => void) => {
          const { access_token, expires_in } = await json<{ access_token: string; expires_in: number; }>("/api/auth/token");
          cb(access_token, expires_in);
        },
      },
      resolve
    );
  });

  viewer = new Autodesk.Viewing.GuiViewer3D(host, {
    // NavTools puts first-person walkthrough in the viewer's own camera menu.
    extensions: ["Autodesk.DefaultTools.NavTools", "Autodesk.DocumentBrowser"],
  });
  if (viewer.start() !== 0) throw new Error("Failed to start the APS Viewer.");
}

/** Resolves once geometry is actually on screen, not merely when the load call returns. */
export async function loadModel(urn: string, name: string): Promise<void> {
  const viewerRef = viewer;
  if (!viewerRef) throw new Error("The viewer has not been initialized.");

  const doc = await new Promise<any>((resolve, reject) => {
    Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      resolve,
      (code: number, msg: string) => reject(new Error(`Document.load failed (${code}): ${msg}`))
    );
  });

  const node = doc.getRoot().getDefaultGeometry();
  if (!node) throw new Error("This model has no default viewable.");

  let onGeometryLoaded: () => void;
  const geometryLoaded = new Promise<void>((resolve) => {
    onGeometryLoaded = () => resolve();
    viewerRef.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
  });

  try {
    await viewerRef.loadDocumentNode(doc, node, { keepCurrentModels: false });
    await geometryLoaded;
  } finally {
    // Otherwise this listener survives to fire on whichever design is picked next.
    viewerRef.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded!);
  }

  // Geometry on screen does not imply a loaded object tree, and nearly every tool needs
  // one — but a model without a tree is still usable, so failing to get one is not fatal.
  await viewerRef.model.getObjectTreeAsync().catch(() => undefined);

  // dbIds belong to a model, so the previous design's colour-coding is not merely stale
  // here, it names objects that no longer exist.
  themingGroups = [];
  modelName = name;
}

/* ------------------------------------------------------------------ model reads */

export function nodeName(dbId: number): string {
  try {
    return requireViewer().model.getObjectTree()?.getNodeName(dbId) ?? `#${dbId}`;
  } catch {
    return `#${dbId}`;
  }
}

export const toNamed = (dbId: number) => ({ dbId, name: nodeName(dbId) });

/**
 * The logical hierarchy, or a throw. Geometry can load without a tree, so the tools that
 * read structure rather than shape have to say so instead of reporting an empty model.
 */
export function requireTree(): any {
  const tree = requireViewer().model.getObjectTree();
  if (!tree) throw new Error("This model has no object tree, so it has no logical hierarchy.");
  return tree;
}

export function rootDbId(): number {
  return requireTree().getRootId();
}

// enumNodeChildren stops the moment its callback returns something truthy, so every
// callback below has a braced body and returns undefined. `(c) => children.push(c)` would
// silently visit exactly one child.

export function childDbIds(dbId: number): number[] {
  const children: number[] = [];
  requireTree().enumNodeChildren(dbId, (child: number) => {
    children.push(child);
  });
  return children;
}

/** Child count without materializing the ids — the fan-out of a node is often the answer. */
export function childCount(dbId: number): number {
  let count = 0;
  requireTree().enumNodeChildren(dbId, () => {
    count++;
  });
  return count;
}

/**
 * Root → `dbId`, inclusive. A path that does not start at the root means `dbId` is not in
 * this model's tree, which the caller should treat as a bad id rather than an empty node.
 */
export function ancestorPath(dbId: number): number[] {
  const tree = requireTree();
  const root = tree.getRootId();
  const path: number[] = [];
  let current = dbId;
  // Depth-bounded rather than `while (true)`: a malformed tree must not hang the browser.
  for (let i = 0; i < 64; i++) {
    path.unshift(current);
    if (current === root) break;
    const parent = tree.getNodeParentId(current);
    if (typeof parent !== "number" || parent === current) break;
    current = parent;
  }
  return path;
}

/** Every leaf dbId in the object tree — the implicit "whole model" set. */
export function allLeafDbIds(): number[] {
  const tree = requireViewer().model.getObjectTree();
  if (!tree) return [];
  const leaves: number[] = [];
  const walk = (dbId: number) => {
    let childCount = 0;
    tree.enumNodeChildren(dbId, (child: number) => {
      childCount++;
      walk(child);
    });
    if (childCount === 0) leaves.push(dbId);
  };
  walk(tree.getRootId());
  return leaves;
}

/**
 * dbIds to operate on: explicit → current selection → whole model. An explicitly empty
 * array is *not* an omitted one — falling back to the whole model there would answer a
 * question about nothing with statistics about everything.
 */
export function resolveDbIds(dbIds?: number[]): { dbIds: number[]; source: string } {
  if (dbIds) {
    if (dbIds.length === 0) throw new Error("`dbIds` was an empty list — nothing to act on.");
    return { dbIds, source: "argument" };
  }
  const selection = requireViewer().getSelection();
  if (selection.length > 0) return { dbIds: selection, source: "selection" };
  return { dbIds: allLeafDbIds(), source: "whole-model" };
}

/** The one selection reader. */
export function getSelection(): number[] {
  return requireViewer().getSelection() ?? [];
}

/** The one property-reading primitive in the app. */
export function bulkProperties(dbIds: number[], propFilter?: string[]): Promise<BulkResult[]> {
  const model = requireViewer().model;
  return new Promise((resolve, reject) => {
    if (dbIds.length === 0) return resolve([]);
    const options = propFilter && propFilter.length > 0 ? { propFilter } : {};
    model.getBulkProperties2(
      dbIds,
      options,
      (results: BulkResult[]) => resolve(results ?? []),
      (err: unknown) => reject(new Error(`getBulkProperties2 failed: ${String(err)}`))
    );
  });
}

export function matchProperty(props: BulkProperty[], wanted: string): BulkProperty | undefined {
  const needle = wanted.trim().toLowerCase();
  return props.find(
    (p) =>
      (p.displayName ?? "").toLowerCase() === needle ||
      (p.attributeName ?? "").toLowerCase() === needle
  );
}

export function units(): string {
  try {
    return requireViewer().model.getUnitString() ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Active section planes as [nx, ny, nz, d], the same shape set-view-state takes. */
export function readCutPlanes(): number[][] {
  const planes = requireViewer().getCutPlanes() ?? [];
  return planes.map((p: any) => [round(p.x), round(p.y), round(p.z), round(p.w, 4)]);
}

/** Union of the world bounds of every geometry instance under a dbId. */
export function worldBox(dbId: number): any {
  const model = requireViewer().model;
  const tree = model.getObjectTree();
  const frags = model.getFragmentList();
  const box = new Autodesk.Viewing.Math.Box3();
  if (!tree || !frags) return box;
  tree.enumNodeInstances(
    dbId,
    (fragId: number) => {
      const b = new Autodesk.Viewing.Math.Box3();
      frags.getWorldBounds(fragId, b);
      box.union(b);
    },
    true
  );
  return box;
}

/* --------------------------------------------------------------------- theming */

// The Viewer writes theming colours but never reads them back — there is no
// `getThemingColor` — so the record lives here. Without it `get-view-state` could not
// report the colour-coding it just applied, and an issue raised on a colour-coded view
// would restore without the colours the issue is about.
let themingGroups: ThemingGroup[] = [];

/**
 * Later groups win, which is what the viewer itself does with an id painted twice.
 * Keeping the record in step with the screen is the whole job: a dbId listed under a
 * colour it no longer wears turns the legend the agent reads out into a lie.
 *
 * Only the ids given are compared. An ancestor and its own descendant both painted stay
 * as two entries, and paint order settles which one shows — see `applyTheming`.
 */
function dedupeTheming(groups: ThemingGroup[]): ThemingGroup[] {
  const seen = new Set<number>();
  const out: ThemingGroup[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    const dbIds: number[] = [];
    for (const dbId of group.dbIds) {
      if (seen.has(dbId)) continue;
      seen.add(dbId);
      dbIds.push(dbId);
    }
    if (dbIds.length > 0) out.unshift({ ...group, dbIds });
  }
  return out;
}

export function readTheming(): ThemingGroup[] {
  return themingGroups.map((group) => ({ ...group, dbIds: [...group.dbIds] }));
}

/** Counts only: a colour-coded floor is thousands of dbIds, which no agent needs listed. */
export function themingSummary() {
  if (themingGroups.length === 0) return null;
  return {
    groups: themingGroups.map((g) => ({ color: g.color, intensity: g.intensity, objects: g.dbIds.length })),
    objects: themingGroups.reduce((n, g) => n + g.dbIds.length, 0),
  };
}

export function clearTheming(): void {
  requireViewer().clearThemingColors();
  themingGroups = [];
}

/**
 * Paint each group, recursively — so a category, family or type node from
 * browse-hierarchy colours every instance beneath it and 5,000 doors can be one dbId.
 *
 * Always clears and repaints the whole record rather than layering onto whatever is on
 * screen. That costs one write per themed object and buys the two properties everything
 * else here depends on: the record always describes the screen exactly, and a later
 * group beats an earlier one the same way whether they arrived in one call or two.
 *
 * @param keep true to add to the current colour-coding instead of replacing it.
 */
export function applyTheming(groups: ThemingGroup[], keep: boolean): ThemingGroup[] {
  const viewerRef = requireViewer();

  // Every colour is parsed before anything is painted: a bad hex in the third group must
  // not leave the first two on screen with the record disagreeing about them.
  const next = dedupeTheming(keep ? [...themingGroups, ...groups] : groups).map((group) => {
    const parsed = parseHexColor(group.color);
    if (!parsed) throw new Error(`"${group.color}" is not a hex colour — use "#rrggbb", e.g. "#3b82f6".`);
    return { group: { ...group, color: parsed.hex }, rgb: parsed.rgb };
  });

  viewerRef.clearThemingColors();
  for (const { group, rgb } of next) {
    const color = new Autodesk.Viewing.Math.Vector4(rgb[0], rgb[1], rgb[2], group.intensity);
    for (const dbId of group.dbIds) viewerRef.setThemingColor(dbId, color, viewerRef.model, true);
  }

  themingGroups = next.map(({ group }) => group);
  return readTheming();
}

/* ---------------------------------------------------------------------- camera */

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
}

function vec3(v: [number, number, number]): any {
  return new Autodesk.Viewing.Math.Vector3(v[0], v[1], v[2]);
}

/** The one camera reader, so a view the agent reads back is in the fields it can write. */
export function readCamera(): CameraState {
  const nav = requireViewer().navigation;
  const camera = nav.getCamera();
  const target = nav.getTarget();
  const tuple = (p: any): [number, number, number] => [round(p.x), round(p.y), round(p.z)];
  return { position: tuple(camera.position), target: tuple(target), up: tuple(camera.up), fov: round(camera.fov, 2) };
}

/** A transition is ~0.5s of flight; this only has to be longer than that. */
const TRANSITION_TIMEOUT_MS = 3000;

/**
 * The transition advances on `requestAnimationFrame`, so a hidden tab — or a model
 * unloaded mid-flight — can leave `CAMERA_TRANSITION_COMPLETED` unfired indefinitely. A
 * tool call has to return, so the wait is capped: the caller then reports a camera
 * caught mid-flight instead of hanging.
 */
async function awaitTransition(viewerRef: any): Promise<void> {
  await Promise.race([
    Autodesk.Viewing.EventUtils.waitUntilTransitionEnded(viewerRef),
    new Promise((resolve) => setTimeout(resolve, TRANSITION_TIMEOUT_MS)),
  ]);
}

/** For callers that start a transition of their own — `fitToView` — and then read back. */
export function awaitCameraTransition(): Promise<void> {
  return awaitTransition(requireViewer());
}

/**
 * Flies to an exact view, resolving once it has landed so the camera read back is the
 * one on screen. `up` and `fov` default to the camera's current.
 *
 * `utilities.transitionView` rather than `navigation.setView`: a hard cut drops the
 * human somewhere else in the building with nothing to say how the two places relate,
 * while the flight path carries exactly that. The transition also parks the pivot on the
 * new target, so the first orbit after the agent moves the camera turns around what the
 * agent aimed at rather than around wherever the last pivot was left.
 */
export async function setCameraView(
  position: [number, number, number],
  target: [number, number, number],
  up?: [number, number, number],
  fov?: number
): Promise<CameraState> {
  const viewerRef = requireViewer();
  const nav = viewerRef.navigation;

  // `reorient: false` — a stored `up` is part of the shot, and recomputing it from world
  // up would quietly level a deliberately rolled view. `worldUp` and `pivot` are left
  // undefined for transitionView to fill with the scene's up vector and the target.
  viewerRef.utilities.transitionView(
    vec3(position),
    vec3(target),
    fov ?? nav.getVerticalFov(),
    up ? vec3(up) : nav.getCamera().up.clone(),
    undefined,
    false
  );

  await awaitTransition(viewerRef);
  return readCamera();
}

/* ------------------------------------------------------------------- viewpoint */

/**
 * The whole restorable view, in the viewer's own format, for storing on an issue.
 * `getState` captures more than this app has fields for — explode scale, render options,
 * whatever the loaded extensions inject — and `restoreState` puts all of it back, which
 * is the point of keeping the state verbatim instead of copying a hand-picked subset of
 * it out and hoping nothing was left behind.
 *
 * Theming rides alongside rather than inside: the viewer state has no field for theming
 * colours, and the viewer will not read them back out either, so the record `applyTheming`
 * keeps is what travels with the issue.
 */
export function readViewpoint(): Viewpoint {
  return { state: requireViewer().getState(), theming: readTheming() };
}

/**
 * Put the viewer back into a stored viewpoint. `restoreState` does the work — visibility,
 * section planes, selection and camera, in the order the SDK settled on — with `immediate`
 * false so the camera flies there rather than cutting: a hard cut drops the human
 * somewhere else in the building with nothing to say how the two places relate, while the
 * flight path carries exactly that.
 *
 * Theming goes on first so the colours are already there when the flight starts, and it
 * replaces rather than layers, for the same reason `restoreState` replaces visibility: an
 * issue stored before colour-coding existed carries none, and arriving at it wearing the
 * colours from the last question asked would look like part of the issue.
 *
 * Deliberately no `fitToView`: the stored camera *is* the framing, and re-framing on the
 * element would throw away the eye position that made the issue legible — inside a room,
 * at head height, looking at one column.
 *
 * Resolves when the camera has arrived, so a caller can report the view that landed.
 *
 * @param selection overrides the stored selection, for an issue whose element outlived it.
 */
export async function restoreViewpoint(viewpoint: Viewpoint, selection?: number[]): Promise<CameraState> {
  const viewerRef = requireViewer();

  applyTheming(viewpoint.theming ?? [], false);

  const { state } = selection ? withSelection(viewpoint, selection) : viewpoint;
  if (!viewerRef.restoreState(state, undefined, false)) {
    throw new Error("The viewer would not restore the stored view state.");
  }

  await awaitTransition(viewerRef);
  return readCamera();
}

/* ------------------------------------------------------------------ view state */

/** Lives here, not in the tool, so the reader and set-view-state cannot drift apart. */
export function readViewState() {
  const viewerRef = requireViewer();
  return {
    model: getModelName(),
    units: units(),
    selection: cap(viewerRef.getSelection() ?? [], toNamed),
    isolated: cap<number>(viewerRef.getIsolatedNodes() ?? []),
    hidden: cap<number>(viewerRef.getHiddenNodes() ?? []),
    cutPlanes: readCutPlanes(),
    theming: themingSummary(),
    camera: readCamera(),
  };
}
