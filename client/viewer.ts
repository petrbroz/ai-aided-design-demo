// Viewer SDK v7.126, pinned by the page. Two v7.12x changes shape the code below:
// `getObjectTree` replaces the deprecated `getInstanceTree` (7.122), and the SDK's
// vector/box types live on `Autodesk.Viewing.Math` rather than the `THREE` global
// (7.120/7.122), where `THREE` is now only a compatibility shim.

import type { Viewpoint } from "./issue-schema.js";
import { cap, json, round } from "./utils.js";

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

/** An exact jump, no path animation. `up` and `fov` default to the camera's current. */
export function setCameraView(
  position: [number, number, number],
  target: [number, number, number],
  up?: [number, number, number],
  fov?: number
): CameraState {
  const nav = requireViewer().navigation;
  const upVec = up ? vec3(up) : nav.getCamera().up.clone();

  nav.setView(vec3(position), vec3(target), upVec);
  if (fov !== undefined) nav.setVerticalFov(fov, false);

  return readCamera();
}

/* ------------------------------------------------------------------- viewpoint */

/**
 * The whole restorable view, uncapped, for storing on an issue. Deliberately not
 * `readViewState`: that one is agent-facing and caps its lists at 50, and a truncated
 * hidden set restores a *different* view while claiming to be the original one.
 */
export function readViewpoint(): Viewpoint {
  const viewerRef = requireViewer();
  return {
    camera: readCamera(),
    cutPlanes: readCutPlanes(),
    isolated: [...(viewerRef.getIsolatedNodes() ?? [])],
    hidden: [...(viewerRef.getHiddenNodes() ?? [])],
    selection: [...(viewerRef.getSelection() ?? [])],
  };
}

/**
 * Put the viewer back into a stored viewpoint: visibility, then section, then selection,
 * then camera. That order matters — visibility is reset from scratch before the stored
 * sets go back on (whatever is hidden *now* is not part of the issue), and the camera
 * goes last because nothing after it may re-frame.
 *
 * Deliberately no `fitToView`: the stored camera *is* the framing, and re-framing on the
 * element would throw away the eye position that made the issue legible — inside a room,
 * at head height, looking at one column.
 *
 * @param selection overrides the stored selection, for an issue whose element outlived it.
 */
export function restoreViewpoint(viewpoint: Viewpoint, selection?: number[]): CameraState {
  const viewerRef = requireViewer();

  // `aggregateRestore` is the call the SDK's own ViewerState.restoreState makes, and the
  // reason to reach past the public API for it: an empty `isolatedIds` resets visibility
  // outright, hiding is done with `skipIsolated` so a hidden ancestor cannot re-hide an
  // isolated child, and it fires the aggregate isolation/hidden events that keep the
  // Model Browser in step. `viewer.isolate()` + `viewer.hide()` does neither of the last
  // two. Private, but the SDK version is pinned by the page, so it cannot move under us.
  viewerRef.impl.visibilityManager.aggregateRestore([
    { model: viewerRef.model, isolatedIds: viewpoint.isolated, hiddenIds: viewpoint.hidden },
  ]);

  viewerRef.setCutPlanes(
    viewpoint.cutPlanes.map(([x, y, z, w]) => new Autodesk.Viewing.Math.Vector4(x, y, z, w))
  );

  const dbIds = selection ?? viewpoint.selection;
  if (dbIds.length > 0) viewerRef.select(dbIds);
  else viewerRef.clearSelection();

  const { camera } = viewpoint;
  return setCameraView(camera.position, camera.target, camera.up, camera.fov);
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
    camera: readCamera(),
  };
}
