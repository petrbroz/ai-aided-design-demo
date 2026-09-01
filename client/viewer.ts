/**
 * Everything that knows about the APS Viewer: bootstrapping it, loading a model, and
 * the small set of primitives the tools are built from (instance-tree walks, property
 * reads, bounding boxes, theming). Nothing here knows that WebMCP exists.
 *
 * The demo bucket holds pre-uploaded, pre-translated SVF2 designs, so there is no
 * manifest polling and no translation UI — the viewer is initialized once for SVF2
 * and models load straight away.
 */

import { hexToRgb01, json, round } from "./utils.js";

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

  modelName = name;
  themingActive = false;
  currentLegend = null;
}

/* ------------------------------------------------------------------ model reads */

export function nodeName(dbId: number): string {
  try {
    return requireViewer().model.getInstanceTree()?.getNodeName(dbId) ?? `#${dbId}`;
  } catch {
    return `#${dbId}`;
  }
}

export const toNamed = (dbId: number) => ({ dbId, name: nodeName(dbId) });

/** Every leaf dbId in the instance tree — the implicit "whole model" set. */
export function allLeafDbIds(): number[] {
  const tree = requireViewer().model.getInstanceTree();
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

/** dbIds to operate on: explicit → current selection → whole model. */
export function resolveDbIds(dbIds?: number[]): { dbIds: number[]; source: string } {
  if (dbIds && dbIds.length > 0) return { dbIds, source: "argument" };
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

/** Union of the world bounds of every fragment under a dbId. */
export function worldBox(dbId: number): any {
  const model = requireViewer().model;
  const tree = model.getInstanceTree();
  const frags = model.getFragmentList();
  const box = new THREE.Box3();
  if (!tree || !frags) return box;
  tree.enumNodeFragments(
    dbId,
    (fragId: number) => {
      const b = new THREE.Box3();
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

function instanceTree(): any {
  const tree = requireViewer().model.getInstanceTree();
  if (!tree) throw new Error("This model has no logical hierarchy (no instance tree).");
  return tree;
}

function describeNode(tree: any, dbId: number): HierarchyNode {
  let childCount = 0;
  tree.enumNodeChildren(dbId, () => childCount++);
  return { dbId, name: tree.getNodeName(dbId) ?? `#${dbId}`, childCount, isLeaf: childCount === 0 };
}

/** The top of the tree — the implicit starting point when no dbId is given. */
export function rootDbId(): number {
  return instanceTree().getRootId();
}

/** A node, its parent (if any), and its immediate children — one step of a browse. */
export function hierarchyStep(dbId: number): {
  node: HierarchyNode;
  parent: HierarchyNode | null;
  children: HierarchyNode[];
} {
  const tree = instanceTree();
  const node = describeNode(tree, dbId);
  const parentId = tree.getNodeParentId(dbId);
  const parent = parentId && parentId !== dbId ? describeNode(tree, parentId) : null;

  const childIds: number[] = [];
  tree.enumNodeChildren(dbId, (child: number) => childIds.push(child));

  return { node, parent, children: childIds.map((id) => describeNode(tree, id)) };
}

/** Root-to-parent breadcrumb (excludes `dbId` itself), for orientation while browsing. */
export function ancestryOf(dbId: number): HierarchyNode[] {
  const tree = instanceTree();
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

/* ---------------------------------------------------------------------- camera */

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
}

function vec3(v: [number, number, number]): any {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function readCamera(): CameraState {
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

/* --------------------------------------------------------------------- theming */

/** Repaint from a clean slate so the legend always matches what is on screen. */
export function applyTheming(
  groups: Array<{ label: string; color: string; dbIds: number[] }>
): LegendEntry[] {
  const viewerRef = requireViewer();
  viewerRef.model.clearThemingColors();

  const legend: LegendEntry[] = groups.map(({ label, color, dbIds }) => {
    const [r, g, b] = hexToRgb01(color);
    const vec = new THREE.Vector4(r, g, b, 1);
    for (const dbId of dbIds) viewerRef.model.setThemingColor(dbId, vec, true);
    return { label, color, count: dbIds.length };
  });

  themingActive = true;
  currentLegend = legend;
  viewerRef.impl.invalidate(true, true, true);
  return legend;
}

export function clearTheming(): void {
  const viewerRef = requireViewer();
  viewerRef.model.clearThemingColors();
  themingActive = false;
  currentLegend = null;
  viewerRef.impl.invalidate(true, true, true);
}
