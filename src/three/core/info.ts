// Dimensions and cursor readout: bounding boxes in display coordinates, triangle counts, number
// formatting, and BVH-accelerated picking (three-mesh-bvh, built lazily per geometry).
import { Box3, Matrix4, Raycaster, Sphere, Vector3, type BufferGeometry, type Camera, type Intersection, type Mesh, type Object3D, type Vector2 } from "three";
import { MeshBVH } from "three-mesh-bvh";
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

function trianglesOf(g: BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3);
}

/** Triangles of the triangle meshes under `root` (edge overlays, points and lines excluded). */
export function meshTriangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as Drawable).isMesh && !o.userData.vaEdges) n += trianglesOf((o as Mesh).geometry);
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
  /** Build (lazily) and use a BVH per geometry; off = plain three.js raycast. */
  bvh: boolean;
  /** World points cut away by section planes: hits there are skipped. */
  clipped?: (p: Vector3) => boolean;
}

/** Nearest visible mesh hit under a screen point. */
export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly sphere = new Sphere();
  private readonly hits: Intersection[] = [];

  /** `ndc`: normalized device coordinates (-1..1, y up). */
  pick(root: Object3D, camera: Camera, ndc: Vector2, opts: PickOptions): Intersection | null {
    const raycaster = this.raycaster;
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    // With sections on, the first hit may be cut away: collect all hits of a mesh then.
    raycaster.firstHitOnly = !opts.clipped;
    let best: Intersection | null = null;
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      const mesh = o as Mesh;
      if (mesh.isMesh && !o.userData.vaEdges) {
        const g = mesh.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        this.sphere.copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld);
        const reach = ray.origin.distanceTo(this.sphere.center) - this.sphere.radius;
        if (ray.intersectsSphere(this.sphere) && !(best && reach > best.distance)) {
          // Lazily, and only for meshes the ray reaches. `indirect` leaves the geometry (and its
          // GPU buffers) untouched.
          if (opts.bvh && !g.boundsTree) g.boundsTree = new MeshBVH(g, { indirect: true });
          this.hits.length = 0;
          if (g.boundsTree) g.boundsTree.raycastObject3D(mesh, raycaster, this.hits);
          else mesh.raycast(raycaster, this.hits);
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
    return best;
  }

  /** Drop the BVHs under `root` (file removed). */
  release(root: Object3D): void {
    root.traverse((o) => {
      const g = (o as Drawable).geometry;
      if (g?.boundsTree) delete g.boundsTree;
    });
  }
}
