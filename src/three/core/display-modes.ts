// Display modes (solid, wire, solid + edges, x-ray) applied to the materials under a root, plus
// the shared section planes. Edge lines (EdgesGeometry, 30°) are built the first time a mesh needs
// them and cached per geometry: tiny meshes right away, the rest in the geometry worker (attached
// as they arrive). They hang under their mesh (userData.vaEdges) so they follow its transform and
// visibility.
import { BufferAttribute, BufferGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, type Material, type Mesh, type Object3D, type Plane } from "three";
import { EDGE_THRESHOLD_DEG, GeometryJobs, PRIORITY, triangles } from "./geometry-jobs";

export type DisplayMode = "solid" | "wire" | "edges" | "xray";
export const DISPLAY_MODES: readonly DisplayMode[] = ["solid", "wire", "edges", "xray"];
export const DISPLAY_MODE_LABELS: Readonly<Record<DisplayMode, string>> = {
  solid: "솔리드",
  wire: "와이어",
  edges: "솔리드+엣지",
  xray: "X-ray",
};

/** Above this many triangles in the scene, edges are off (building them would stall the UI). */
export const EDGE_TRIANGLE_LIMIT = 5_000_000;
/** Meshes below this many triangles get their edges on the UI thread... */
export const SYNC_EDGE_TRIANGLES = 50_000;
/** ...up to this many triangles per `apply` in total (thousands of small parts go to the worker). */
const SYNC_EDGE_BUDGET = 200_000;
const XRAY_OPACITY = 0.3;

export function canShowEdges(triangles: number): boolean {
  return triangles <= EDGE_TRIANGLE_LIMIT;
}

export class EdgeCache {
  private readonly cache = new Map<BufferGeometry, BufferGeometry>();

  peek(geometry: BufferGeometry): BufferGeometry | undefined {
    return this.cache.get(geometry);
  }

  put(geometry: BufferGeometry, edges: BufferGeometry): void {
    this.cache.get(geometry)?.dispose();
    this.cache.set(geometry, edges);
  }

  get(geometry: BufferGeometry): BufferGeometry {
    let edges = this.cache.get(geometry);
    if (!edges) {
      edges = new EdgesGeometry(geometry, EDGE_THRESHOLD_DEG);
      this.cache.set(geometry, edges);
    }
    return edges;
  }

  release(geometry: BufferGeometry): void {
    this.cache.get(geometry)?.dispose();
    this.cache.delete(geometry);
  }

  dispose(): void {
    for (const e of this.cache.values()) e.dispose();
    this.cache.clear();
  }
}

/** Material fields a mode changes; the original values are kept to restore solid. */
interface BaseState {
  wireframe?: boolean;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

type AnyMaterial = Material & { wireframe?: boolean };

function materialsOf(o: Object3D): AnyMaterial[] {
  const m = (o as Mesh).material as AnyMaterial | AnyMaterial[] | undefined;
  return m === undefined ? [] : Array.isArray(m) ? m : [m];
}

function baseOf(m: AnyMaterial): BaseState {
  let base = m.userData.vaBase as BaseState | undefined;
  if (!base) {
    base = {
      wireframe: m.wireframe,
      transparent: m.transparent,
      opacity: m.opacity,
      depthWrite: m.depthWrite,
      polygonOffset: m.polygonOffset,
      polygonOffsetFactor: m.polygonOffsetFactor,
      polygonOffsetUnits: m.polygonOffsetUnits,
    };
    m.userData.vaBase = base;
  }
  return base;
}

function setMode(m: AnyMaterial, mode: DisplayMode, isMesh: boolean): void {
  const base = baseOf(m);
  const before = `${m.transparent}:${m.wireframe}`;
  if (base.wireframe !== undefined) m.wireframe = isMesh && mode === "wire" ? true : base.wireframe;
  const xray = mode === "xray";
  m.transparent = xray || base.transparent;
  m.opacity = xray ? XRAY_OPACITY : base.opacity;
  m.depthWrite = xray ? false : base.depthWrite;
  // Edges: push faces back a little so the lines on them win the depth test.
  const offset = isMesh && mode === "edges";
  m.polygonOffset = offset || base.polygonOffset;
  m.polygonOffsetFactor = offset ? 1 : base.polygonOffsetFactor;
  m.polygonOffsetUnits = offset ? 1 : base.polygonOffsetUnits;
  if (`${m.transparent}:${m.wireframe}` !== before) m.needsUpdate = true;
}

export interface DisplayModeHooks {
  /** Something changed on screen outside an `apply` call (edges arrived). */
  render?(): void;
  /** Worker edge jobs: `done` of `total` since the queue was last empty. */
  progress?(done: number, total: number): void;
  /** Override SYNC_EDGE_TRIANGLES (tests). */
  syncEdgeTriangles?: number;
}

export class DisplayModes {
  readonly edgeCache = new EdgeCache();
  readonly edgeMaterial: LineBasicMaterial;
  private mode: DisplayMode = "solid";
  /** Geometries whose edges are being built in the worker -> the mesh to attach them to. */
  private readonly wanted = new Map<BufferGeometry, Mesh>();
  private jobsDone = 0;
  private jobsTotal = 0;

  /** `planes`: the section planes array shared by every material (see clipping.ts). */
  constructor(
    private readonly planes: Plane[] | null = null,
    private readonly jobs = new GeometryJobs(),
    private readonly hooks: DisplayModeHooks = {},
  ) {
    this.edgeMaterial = new LineBasicMaterial({ color: 0x1f2328, transparent: true, opacity: 0.55 });
    this.edgeMaterial.clippingPlanes = planes;
  }

  /** Edge jobs still queued or running. */
  get pendingEdges(): number {
    return this.wanted.size;
  }

  private attach(mesh: Mesh, edges: BufferGeometry): void {
    if (mesh.children.some((c) => c.userData.vaEdges)) return;
    const lines = new LineSegments(edges, this.edgeMaterial);
    lines.userData.vaEdges = true;
    lines.raycast = () => {};
    lines.visible = this.mode === "edges";
    mesh.add(lines);
  }

  private requestEdges(mesh: Mesh): void {
    const g = mesh.geometry;
    if (this.wanted.has(g)) return;
    this.wanted.set(g, mesh);
    this.jobsTotal++;
    this.hooks.progress?.(this.jobsDone, this.jobsTotal);
    void this.jobs.request("edges", g, PRIORITY.edges).then((positions) => {
      const target = this.wanted.get(g);
      if (!target) return; // released meanwhile (counted there)
      this.wanted.delete(g);
      if (positions) {
        const edges = new BufferGeometry();
        edges.setAttribute("position", new BufferAttribute(positions, 3));
        this.edgeCache.put(g, edges);
        this.attach(target, edges);
      }
      this.jobDone();
      this.hooks.render?.();
    });
  }

  private jobDone(): void {
    this.jobsDone++;
    this.hooks.progress?.(this.jobsDone, this.jobsTotal);
    if (this.jobsDone >= this.jobsTotal) this.jobsDone = this.jobsTotal = 0;
  }

  /**
   * Put every material under `root` in `mode` and give it the section planes. Idempotent, so it
   * also serves newly added files. Edge lines are built (once per geometry) only in edges mode.
   */
  apply(root: Object3D, mode: DisplayMode): void {
    this.mode = mode;
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      if (o.userData.vaEdges) return;
      const isMesh = (o as Mesh).isMesh === true;
      for (const m of materialsOf(o)) {
        setMode(m, mode, isMesh);
        if (m.clippingPlanes !== this.planes) {
          m.clippingPlanes = this.planes;
          m.needsUpdate = true;
        }
      }
      if (isMesh) meshes.push(o as Mesh);
    });
    const syncLimit = this.hooks.syncEdgeTriangles ?? SYNC_EDGE_TRIANGLES;
    let budget = SYNC_EDGE_BUDGET;
    for (const mesh of meshes) {
      const lines = mesh.children.find((c) => c.userData.vaEdges);
      if (lines) lines.visible = mode === "edges";
      else if (mode === "edges") {
        const cached = this.edgeCache.peek(mesh.geometry);
        const n = triangles(mesh.geometry);
        if (cached) this.attach(mesh, cached);
        else if (n < syncLimit && n <= budget) {
          budget -= n;
          this.attach(mesh, this.edgeCache.get(mesh.geometry));
        } else this.requestEdges(mesh);
      }
    }
  }

  /** Remove the edge lines under `root` and dispose their cached geometry (file removed). */
  release(root: Object3D): void {
    const lines: Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.vaEdges) lines.push(o);
    });
    for (const l of lines) {
      const parent = l.parent as Mesh | null;
      l.removeFromParent();
      if (parent?.geometry) this.edgeCache.release(parent.geometry);
    }
    root.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (!g || !this.wanted.has(g)) return;
      this.wanted.delete(g);
      this.jobs.cancel(g);
      this.edgeCache.release(g);
      this.jobDone();
    });
  }

  dispose(): void {
    this.edgeCache.dispose();
    this.edgeMaterial.dispose();
  }
}
