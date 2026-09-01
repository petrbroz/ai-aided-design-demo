/**
 * Everything that knows about the APS Viewer: bootstrapping it, loading a model, and
 * the small set of primitives the tools are built from (object-tree walks, property
 * reads, bounding boxes, theming). Nothing here knows that WebMCP exists.
 *
 * The demo bucket holds pre-uploaded, pre-translated SVF2 designs, so there is no
 * manifest polling and no translation UI — the viewer is initialized once for SVF2
 * and models load straight away.
 *
 * Written against Viewer SDK v7.126, which the page pins explicitly. Two v7.12x
 * changes shape the code below: `Model#getInstanceTree` is deprecated in favour of
 * `Model#getObjectTree` (7.122), and `Autodesk.Viewing.Math` — not the `THREE`
 * global — is now where the SDK's vector and box types live (7.120/7.122). `THREE`
 * still resolves to the very same classes, but only as a compatibility shim.
 */

import { cap, hexToRgb01, json, round } from "./utils.js";

export type Axis = "x" | "y" | "z";

export interface LegendEntry {
  label: string;
  color: string;
  count: number;
}

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
let themingActive = false;
let currentLegend: LegendEntry[] | null = null;

/** The viewer, or a throw the tool layer turns into `{ error }`. */
export function requireViewer(): any {
  if (!viewer || !viewer.model) throw new Error("No model is loaded yet.");
  return viewer;
}

export function getModelName(): string {
  return modelName;
}

export function isThemingActive(): boolean {
  return themingActive;
}

export function getLegend(): LegendEntry[] | null {
  return currentLegend;
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
    // DocumentBrowser adds its own toolbar button for switching between the
    // models/views the loaded Document exposes (e.g. 2D sheets, 3D views).
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

  // Geometry on screen does not imply a loaded object tree, and nearly every tool
  // needs one. getObjectTreeAsync (7.124) is the awaitable form of the same read;
  // a model that genuinely has no tree is still a usable model, so failure to
  // produce one is not failure to load.
  await viewerRef.model.getObjectTreeAsync().catch(() => undefined);

  modelName = name;
  themingActive = false;
  currentLegend = null;
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
 * dbIds to operate on: explicit → current selection → whole model.
 *
 * An explicitly empty array is *not* the same as an omitted one. The common agent
 * flow is search-design → no hits → pass the empty result straight on; falling back
 * to the whole model there would answer a question about nothing with statistics
 * about everything.
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
  // `enumNodeFragments` still works as an alias, but instances are what the public
  // ObjectTree API calls them.
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

/* ------------------------------------------------------------------- hierarchy */

export interface HierarchyNode {
  dbId: number;
  name: string;
  childCount: number;
  isLeaf: boolean;
}

function objectTree(): any {
  const tree = requireViewer().model.getObjectTree();
  if (!tree) throw new Error("This model has no logical hierarchy (no object tree).");
  return tree;
}

function describeNode(tree: any, dbId: number): HierarchyNode {
  let childCount = 0;
  tree.enumNodeChildren(dbId, () => {
    childCount++;
  });
  return { dbId, name: tree.getNodeName(dbId) ?? `#${dbId}`, childCount, isLeaf: childCount === 0 };
}

/** The top of the tree — the implicit starting point when no dbId is given. */
export function rootDbId(): number {
  return objectTree().getRootId();
}

/** Root-to-parent breadcrumb (excludes `dbId` itself), for orientation while browsing. */
function ancestryOf(tree: any, dbId: number): HierarchyNode[] {
  const chain: HierarchyNode[] = [];
  const seen = new Set<number>([dbId]);

  let current = tree.getNodeParentId(dbId);
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(describeNode(tree, current));
    current = tree.getNodeParentId(current);
  }
  return chain;
}

/**
 * A node, its breadcrumb back to the root, and its immediate children — one step of
 * a browse. The parent is just the last ancestor, so it is not returned twice.
 *
 * `maxChildren` is applied *before* describeNode runs, because describeNode
 * enumerates each child's own children to count them; capping afterwards would walk
 * the entire grandchild layer only to discard it.
 */
export function hierarchyStep(dbId: number, maxChildren: number) {
  const tree = objectTree();
  const childIds: number[] = [];
  tree.enumNodeChildren(dbId, (child: number) => {
    childIds.push(child);
  });

  return {
    node: describeNode(tree, dbId),
    ancestors: ancestryOf(tree, dbId),
    children: cap(childIds, (id) => describeNode(tree, id), maxChildren),
  };
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

/** The single camera reader — shared by get-view-state and set-view-state, so a view
 * the agent reads back is expressed in exactly the fields it can write. */
export function readCamera(): CameraState {
  const nav = requireViewer().navigation;
  const camera = nav.getCamera();
  const target = nav.getTarget();
  const tuple = (p: any): [number, number, number] => [round(p.x), round(p.y), round(p.z)];
  return { position: tuple(camera.position), target: tuple(target), up: tuple(camera.up), fov: round(camera.fov, 2) };
}

/**
 * Jumps the camera to an exact position/orientation — no path animation, unlike
 * `fitToView`. `up` and `fov` default to whatever the camera already has.
 */
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

/* ------------------------------------------------------------------ view state */

/**
 * Everything the agent can observe about the current view, and — bar the selection —
 * everything set-view-state can write. Lives here rather than in the tool so the
 * reader and the writer cannot drift apart: set-view-state returns this too.
 */
export function readViewState() {
  const viewerRef = requireViewer();
  return {
    model: getModelName(),
    units: units(),
    selection: cap(viewerRef.getSelection() ?? [], toNamed),
    isolated: cap<number>(viewerRef.getIsolatedNodes() ?? []),
    hidden: cap<number>(viewerRef.getHiddenNodes() ?? []),
    cutPlanes: readCutPlanes(),
    themingActive: isThemingActive(),
    legend: getLegend(),
    camera: readCamera(),
  };
}

/* --------------------------------------------------------------------- theming */

/**
 * Repaint from a clean slate so the legend always matches what is on screen.
 *
 * Every colour is parsed before anything is painted: parsing mid-paint would let a
 * bad colour in the third group throw after two are already on screen, leaving the
 * viewport themed while `themingActive`/`currentLegend` still say it is not.
 */
export function applyTheming(
  groups: Array<{ label: string; color: string; dbIds: number[] }>
): LegendEntry[] {
  const viewerRef = requireViewer();
  const parsed = groups.map(({ label, color, dbIds }) => {
    const [r, g, b] = hexToRgb01(color);
    return { label, color, dbIds, vec: new Autodesk.Viewing.Math.Vector4(r, g, b, 1) };
  });

  viewerRef.model.clearThemingColors();
  for (const { dbIds, vec } of parsed) {
    for (const dbId of dbIds) viewerRef.model.setThemingColor(dbId, vec, true);
  }

  themingActive = true;
  currentLegend = parsed.map(({ label, color, dbIds }) => ({ label, color, count: dbIds.length }));
  viewerRef.impl.invalidate(true, true, true);
  return currentLegend;
}

export function clearTheming(): void {
  const viewerRef = requireViewer();
  viewerRef.model.clearThemingColors();
  themingActive = false;
  currentLegend = null;
  viewerRef.impl.invalidate(true, true, true);
}
