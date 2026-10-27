// Geometry jobs (edges, BVHs) for the worker: results match the UI-thread versions, one job at a
// time by priority, deduplicated, cancellable, inputs copied (the shown geometry stays intact).
import { expect, test } from "vitest";
import { BoxGeometry, EdgesGeometry, Mesh, Ray, Raycaster, Vector3, type Intersection } from "three";
import { bvhData, bvhFrom, edgePositions, GeometryJobs, inputOf, PRIORITY, type JobKind, type JobRunner } from "../src/three/core/geometry-jobs";

test("edgePositions equals three's EdgesGeometry at 30°", () => {
  const g = new BoxGeometry(1, 2, 3, 2, 2, 2);
  const expected = new EdgesGeometry(g, 30).getAttribute("position").array;
  expect(Array.from(edgePositions(inputOf(g)))).toEqual(Array.from(expected));
});

test("a BVH built on a copy works for the original geometry (indirect: index untouched)", () => {
  const g = new BoxGeometry(2, 2, 2);
  const indexBefore = Array.from(g.index!.array);
  g.boundsTree = bvhFrom(bvhData(inputOf(g)), g);
  expect(Array.from(g.index!.array)).toEqual(indexBefore);
  const mesh = new Mesh(g);
  mesh.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
  const hits: Intersection[] = [];
  g.boundsTree.raycastObject3D(mesh, raycaster, hits);
  expect(hits[0].point.z).toBeCloseTo(1);
});

test("inputOf copies: transferring the copy leaves the geometry usable", () => {
  const g = new BoxGeometry();
  const input = inputOf(g);
  expect(input.positions).not.toBe(g.getAttribute("position").array);
  expect(input.index).not.toBe(g.index!.array);
});

function manual() {
  const started: [JobKind, number][] = [];
  const finish: (() => void)[] = [];
  const runner: JobRunner = (kind, input) => {
    started.push([kind, input.positions.length]);
    return new Promise((resolve) => finish.push(() => resolve(kind === "edges" ? new Float32Array(1) : bvhData(input))));
  };
  const step = async () => {
    finish.shift()!();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { runner, started, step };
}

test("one job at a time, highest priority first; asking again dedupes and can raise priority", async () => {
  const { runner, started, step } = manual();
  const jobs = new GeometryJobs(runner);
  const [a, b, c] = [new BoxGeometry(), new BoxGeometry(1, 1, 1, 2), new BoxGeometry(1, 1, 1, 3)];
  void jobs.request("bvh", a, PRIORITY.prebuild); // starts at once
  void jobs.request("bvh", b, PRIORITY.prebuild);
  void jobs.request("bvh", c, PRIORITY.prebuild);
  const again = jobs.request("bvh", c, PRIORITY.pick); // same job, now ahead of b
  void jobs.request("edges", b, PRIORITY.edges); // edges first of all
  expect(jobs.size).toBe(4);
  expect(started).toHaveLength(1);
  await step();
  await step();
  await step();
  await step();
  const sizes = (g: BoxGeometry) => g.getAttribute("position").array.length;
  expect(started).toEqual([
    ["bvh", sizes(a)],
    ["edges", sizes(b)],
    ["bvh", sizes(c)],
    ["bvh", sizes(b)],
  ]);
  expect(await again).not.toBeNull();
  expect(jobs.size).toBe(0);
});

test("cancel: queued jobs resolve null without running; a running one resolves null", async () => {
  const { runner, started, step } = manual();
  const jobs = new GeometryJobs(runner);
  const [a, b] = [new BoxGeometry(), new BoxGeometry()];
  const running = jobs.request("edges", a);
  const queued = jobs.request("edges", b);
  jobs.cancel(b);
  jobs.cancel(a);
  expect(await queued).toBeNull();
  await step();
  expect(await running).toBeNull();
  expect(started).toHaveLength(1);
});

test("a failing runner resolves null and the queue goes on", async () => {
  let n = 0;
  const jobs = new GeometryJobs(async (kind, input) => {
    if (n++ === 0) throw new Error("worker died");
    return kind === "edges" ? edgePositions(input) : bvhData(input);
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(await jobs.request("edges", new BoxGeometry())).toBeNull();
    expect(await jobs.request("edges", new BoxGeometry())).toBeInstanceOf(Float32Array);
  } finally {
    console.warn = warn;
  }
});
