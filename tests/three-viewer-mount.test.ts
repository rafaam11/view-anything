// @vitest-environment happy-dom
// mount() must not wait for the first file: appends during a slow first load are queued at once.
import { expect, test, vi } from "vitest";

vi.mock("../src/platform", () => ({
  platform: {
    assetUrl: (p: string) => "asset://" + p,
    readFileRaw: async () => new ArrayBuffer(0),
    setWindowTitle: async () => {},
  },
}));

// The first load never finishes during the test (a big STEP still tessellating).
vi.mock("../src/three/load", () => ({
  loadMeshFile: () => new Promise(() => {}),
  loadGltfFile: () => new Promise(() => {}),
}));

vi.mock("../src/three/core/stage", () => {
  class Stage {
    add() {}
    remove() {}
    fitAll() {}
    setView() {}
    setObjectVisible() {}
    async reveal() {}
  }
  class WebGLUnavailableError extends Error {}
  return { Stage, WebGLUnavailableError };
});

import viewer from "../src/three/viewer";

test("mount resolves while the first file is still loading; an append shows its row at once", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  let mounted = false;
  void viewer.mount(host, "D:\\m\\big.step").then(() => (mounted = true));
  await vi.waitFor(() => expect(mounted).toBe(true));
  expect(host.querySelectorAll(".va3d-node.loading")).toHaveLength(1);
  const left = viewer.accept!(["D:\\m\\b.stl", "D:\\d\\x.md"], { newWindow: false });
  expect(left).toEqual(["D:\\d\\x.md"]);
  const rows = host.querySelectorAll<HTMLElement>(".va3d-node.loading");
  expect(rows).toHaveLength(2);
  expect(rows[1].textContent).toContain("b.stl");
  expect(rows[1].querySelector(".va3d-remove")).not.toBeNull();
});
