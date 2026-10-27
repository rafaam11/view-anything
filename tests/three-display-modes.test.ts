// Display modes: material state per mode, cached edge geometry, the 5M-triangle edge limit.
import { expect, test, vi } from "vitest";
import { bvhData, edgePositions, GeometryJobs, type JobRunner } from "../src/three/core/geometry-jobs";
import { BoxGeometry, Group, LineSegments, Mesh, MeshStandardMaterial, Plane, Points, PointsMaterial } from "three";
import { canShowEdges, DisplayModes, EDGE_TRIANGLE_LIMIT, EdgeCache } from "../src/three/core/display-modes";

function scene() {
  const material = new MeshStandardMaterial();
  const a = new Mesh(new BoxGeometry(), material);
  const b = new Mesh(new BoxGeometry(), material);
  const points = new Points(new BoxGeometry(), new PointsMaterial());
  const root = new Group().add(a, b, points);
  return { root, a, b, material, points };
}

const edgesOf = (m: Mesh) => m.children.find((c) => c.userData.vaEdges) as LineSegments | undefined;

test("EdgeCache builds a geometry's edges once and reuses them", () => {
  const cache = new EdgeCache();
  const g = new BoxGeometry();
  const e1 = cache.get(g);
  expect(cache.get(g)).toBe(e1);
  expect(e1.getAttribute("position").count).toBe(24); // 12 box edges (30° threshold drops the diagonals)
  let disposed = false;
  e1.addEventListener("dispose", () => (disposed = true));
  cache.release(g);
  expect(disposed).toBe(true);
  expect(cache.get(g)).not.toBe(e1);
});

test("edges mode adds cached edge lines; switching away hides them and back reuses the same geometry", () => {
  const { root, a, b } = scene();
  const modes = new DisplayModes();
  modes.apply(root, "edges");
  const ea = edgesOf(a)!;
  expect(ea.visible).toBe(true);
  expect(edgesOf(b)).toBeDefined();
  const geometry = ea.geometry;
  modes.apply(root, "solid");
  expect(edgesOf(a)!.visible).toBe(false);
  modes.apply(root, "edges");
  expect(edgesOf(a)).toBe(ea);
  expect(edgesOf(a)!.geometry).toBe(geometry);
  expect(a.children.filter((c) => c.userData.vaEdges)).toHaveLength(1);
});

test("x-ray: opacity 0.3, transparent, no depth write; solid restores the original material state", () => {
  const { root, material, points } = scene();
  const modes = new DisplayModes();
  modes.apply(root, "xray");
  expect(material.transparent).toBe(true);
  expect(material.opacity).toBe(0.3);
  expect(material.depthWrite).toBe(false);
  expect((points.material as PointsMaterial).opacity).toBe(0.3);
  modes.apply(root, "wire");
  expect(material.wireframe).toBe(true);
  expect(material.transparent).toBe(false);
  expect(material.opacity).toBe(1);
  modes.apply(root, "solid");
  expect(material.wireframe).toBe(false);
  expect(material.depthWrite).toBe(true);
});

test("clipping planes go to every material, edge lines included (one shared array)", () => {
  const { root, a, material, points } = scene();
  const planes: Plane[] = [];
  const modes = new DisplayModes(planes);
  modes.apply(root, "edges");
  expect(material.clippingPlanes).toBe(planes);
  expect((points.material as PointsMaterial).clippingPlanes).toBe(planes);
  expect((edgesOf(a)!.material as MeshStandardMaterial).clippingPlanes).toBe(planes);
});

test("release drops edge lines under a root and disposes their cached geometry", () => {
  const { root, a } = scene();
  const modes = new DisplayModes();
  modes.apply(root, "edges");
  const g = edgesOf(a)!.geometry;
  let disposed = false;
  g.addEventListener("dispose", () => (disposed = true));
  modes.release(root);
  expect(edgesOf(a)).toBeUndefined();
  expect(disposed).toBe(true);
});

test("edges are allowed up to 5M triangles", () => {
  expect(EDGE_TRIANGLE_LIMIT).toBe(5_000_000);
  expect(canShowEdges(5_000_000)).toBe(true);
  expect(canShowEdges(5_000_001)).toBe(false);
});

/** Worker stand-in: jobs finish only on `flush`. */
function deferred() {
  const pending: (() => void)[] = [];
  const runner: JobRunner = (kind, input) => new Promise((resolve) => pending.push(() => resolve(kind === "edges" ? edgePositions(input) : bvhData(input))));
  const flush = async () => {
    while (pending.length) {
      pending.shift()!();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
  };
  return { runner, flush, pending };
}

test("big meshes get their edges from the worker: nothing built on the UI thread, attached on arrival with progress", async () => {
  const { root, a, b } = scene();
  const { runner, flush } = deferred();
  const progress = vi.fn();
  const render = vi.fn();
  const modes = new DisplayModes(null, new GeometryJobs(runner), { syncEdgeTriangles: 0, progress, render });
  const sync = vi.spyOn(modes.edgeCache, "get");
  modes.apply(root, "edges");
  expect(sync).not.toHaveBeenCalled();
  expect(edgesOf(a)).toBeUndefined();
  expect(modes.pendingEdges).toBe(2);
  expect(progress).toHaveBeenLastCalledWith(0, 2);
  modes.apply(root, "edges"); // a refresh while waiting does not ask twice
  expect(modes.pendingEdges).toBe(2);
  await flush();
  expect(edgesOf(a)!.visible).toBe(true);
  expect(edgesOf(b)).toBeDefined();
  expect(edgesOf(a)!.geometry.getAttribute("position").count).toBe(24);
  expect(progress).toHaveBeenLastCalledWith(2, 2);
  expect(render).toHaveBeenCalled();
  // Cached: back to edges after solid reuses them without new jobs.
  modes.apply(root, "solid");
  modes.apply(root, "edges");
  expect(modes.pendingEdges).toBe(0);
});

test("edges arriving after a switch to solid stay hidden; a file removed meanwhile gets none", async () => {
  const { root, a } = scene();
  const { runner, flush } = deferred();
  const modes = new DisplayModes(null, new GeometryJobs(runner), { syncEdgeTriangles: 0 });
  modes.apply(root, "edges");
  modes.apply(root, "solid");
  await flush();
  expect(edgesOf(a)!.visible).toBe(false);

  const other = scene();
  const progress = vi.fn();
  const modes2 = new DisplayModes(null, new GeometryJobs(runner), { syncEdgeTriangles: 0, progress });
  modes2.apply(other.root, "edges");
  modes2.release(other.root);
  await flush();
  expect(edgesOf(other.a)).toBeUndefined();
  expect(modes2.pendingEdges).toBe(0);
  expect(progress).toHaveBeenLastCalledWith(2, 2); // released jobs count as done
});
