// Dimensions and cursor readout: bounding boxes in display coordinates, triangle counts, number
// formatting, and BVH-accelerated picking (three-mesh-bvh, built lazily per geometry).
import { Box3, Matrix4, Raycaster, Sphere, Vector3, type BufferGeometry, type Camera, type Intersection, type Mesh, type Object3D, type Vector2 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { bvhFrom, GeometryJobs, PRIORITY, triangles } from "./geometry-jobs";
import { UNIT_LABELS, type Unit } from "./frames";

/** Above this many triangles in the scene, the hover readout (and its BVHs) is off. */
export const CURSOR_TRIANGLE_LIMIT = 5_000_000;

type Drawable = Object3D & { geometry?: BufferGeometry; isMesh?: boolean };

/** Shown, or hidden only because it waits for its GPU upload (stage `reveal`). */
function shownOrPending(o: Object3D): boolean {
  return o.visible || (o.userData.vaPending === true && o.userData.vaHidden !== true);
}

/**
 * Bounding box of everything drawn under `root`, in display coordinates (= world through the
 * inverse display root matrix). Edge overlays never count. `visibleOnly`: skip hidden subtrees
 * (objects pending upload count as shown).
 */
export function displayBox(root: Object3D, displayToWorld: Matrix4, opts: { visibleOnly?: boolean } = {}): Box3 {
  const toDisplay = displayToWorld.clone().invert();
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  const part = new Box3();
  const m = new Matrix4();
  const visit = (o: Object3D) => {
    if (o.userData.vaEdges) return;
    if (opts.visibleOnly && !shownOrPending(o)) return;
    const g = (o as Drawable).geometry;
    if (g) {
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(part.copy(g.boundingBox!).applyMatrix4(m.multiplyMatrices(toDisplay, o.matrixWorld)));
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return box;
}

/** Triangles of the triangle meshes under `root` (edge overlays, points and lines excluded). */
export function meshTriangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as Drawable).isMesh && !o.userData.vaEdges) n += triangles((o as Mesh).geometry);
  });
  return n;
}

/** Decimals for lengths in a scene whose largest extent is `extent` (about 4 significant digits). */
export function decimalsFor(extent: number): number {
  if (!(extent > 0) || !Number.isFinite(extent)) return 3;
  return Math.min(4, Math.max(0, 3 - Math.floor(Math.log10(extent))));
}

function fixed(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  // No "-0.0".
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function formatSize(size: readonly number[], unit: Unit, decimals: number): string {
  return `${size.map((v) => fixed(v, decimals)).join(" × ")} ${UNIT_LABELS[unit]}`;
}

export function formatPoint(p: readonly number[], decimals: number): string {
  return ["X", "Y", "Z"].map((a, i) => `${a} ${fixed(p[i], decimals)}`).join("  ");
}

export interface PickOptions {
  /**
   * Build missing BVHs: small meshes right away, big ones in the geometry worker (they are
   * skipped until ready, see `PickResult.waiting`). Off: small meshes get a plain raycast, big
   * ones without a BVH are skipped.
   */
  build: boolean;
  /** World points cut away by section planes: hits there are skipped. */
  clipped?: (p: Vector3) => boolean;
}

export interface PickResult {
  hit: Intersection | null;
  /** A mesh on the ray, nearer than the hit (or with no hit), had no BVH yet. */
  waiting: boolean;
}

/** Meshes up to this many triangles may get a BVH (or a plain raycast) on the UI thread. */
export const SYNC_BVH_TRIANGLES = 200_000;

/**
 * Nearest visible mesh hit under a screen point, through per-geometry BVHs (indirect: the
 * geometry and its GPU buffers stay untouched). Big meshes never get a brute-force raycast or a
 * BVH build on the UI thread: their BVH comes from the geometry worker. Points and lines are
 * not picked.
 */
export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly sphere = new Sphere();
  private readonly hits: Intersection[] = [];
  /** Geometries with a BVH requested from the worker and not released. */
  private readonly live = new Set<BufferGeometry>();

  constructor(
    private readonly jobs = new GeometryJobs(),
    private readonly opts: { syncTriangles?: number; onReady?: () => void } = {},
  ) {}

  /** Ask the worker for a BVH (no-op if there is one or it is on its way). */
  request(g: BufferGeometry, priority: number): void {
    if (g.boundsTree || this.jobs.failed("bvh", g)) return;
    if (this.live.has(g)) {
      void this.jobs.request("bvh", g, priority); // promote the queued job without adding another completion handler
      return;
    }
    this.live.add(g);
    void this.jobs.request("bvh", g, priority).then((data) => {
      if (!data) {
        // Failed (marked in the jobs, never asked again) or cancelled.
        if (this.live.delete(g)) this.opts.onReady?.();
        return;
      }
      if (!this.live.has(g) || g.boundsTree) return;
      this.live.delete(g);
      g.boundsTree = bvhFrom(data, g);
      this.opts.onReady?.();
    });
  }

  /** Queue worker BVHs for every mesh under `root` (idle time after upload). */
  prebuild(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && !o.userData.vaEdges) this.request(mesh.geometry, PRIORITY.prebuild);
    });
  }

  /** `ndc`: normalized device coordinates (-1..1, y up). */
  pick(root: Object3D, camera: Camera, ndc: Vector2, opts: PickOptions): PickResult {
    const raycaster = this.raycaster;
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    // With sections on, the first hit may be cut away: collect all hits of a mesh then.
    raycaster.firstHitOnly = !opts.clipped;
    const syncLimit = this.opts.syncTriangles ?? SYNC_BVH_TRIANGLES;
    let budget = syncLimit;
    let best: Intersection | null = null;
    let skipped = Infinity;
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      const mesh = o as Mesh;
      if (mesh.isMesh && !o.userData.vaEdges) {
        const g = mesh.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        this.sphere.copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld);
        const reach = Math.max(0, ray.origin.distanceTo(this.sphere.center) - this.sphere.radius);
        if (ray.intersectsSphere(this.sphere) && !(best && reach > best.distance)) {
          const n = triangles(g);
          const small = n <= syncLimit && n <= budget;
          if (!g.boundsTree && small && opts.build) {
            budget -= n;
            g.boundsTree = new MeshBVH(g, { indirect: true });
          }
          this.hits.length = 0;
          if (g.boundsTree) g.boundsTree.raycastObject3D(mesh, raycaster, this.hits);
          else if (small) mesh.raycast(raycaster, this.hits);
          else if (!this.jobs.failed("bvh", g)) {
            // A mesh whose BVH failed (no worker) is skipped for good, not waited for.
            skipped = Math.min(skipped, reach);
            if (opts.build) this.request(g, PRIORITY.pick);
          }
          for (const h of this.hits) {
            if (opts.clipped?.(h.point)) continue;
            if (!best || h.distance < best.distance) best = h;
          }
        }
      }
      for (const c of o.children) visit(c);
    };
    root.updateWorldMatrix(true, true);
    visit(root);
    this.hits.length = 0;
    const hit = best as Intersection | null;
    return { hit, waiting: skipped < (hit ? hit.distance : Infinity) };
  }

  /** Drop the BVHs under `root` (file removed), queued ones included. */
  release(root: Object3D): void {
    root.traverse((o) => {
      const g = (o as Drawable).geometry;
      if (!g) return;
      if (this.live.delete(g)) this.jobs.cancel(g);
      if (g.boundsTree) delete g.boundsTree;
    });
  }
}
