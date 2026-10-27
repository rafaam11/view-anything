import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), message: vi.fn(), open, save }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));

const { platform } = await import("../src/platform");
const { THREE_D_EXTENSIONS } = await import("../src/three/formats");

beforeEach(() => {
  invoke.mockReset();
  open.mockReset();
  save.mockReset();
});

test("readFileRaw returns the raw IPC ArrayBuffer", async () => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  invoke.mockResolvedValue(buf);
  expect(await platform.readFileRaw("D:\\a b.stl")).toBe(buf);
  expect(invoke).toHaveBeenCalledWith("read_file_raw", { path: "D:\\a b.stl" });
});

test("writeFileRaw sends raw bytes with a percent-encoded path header", async () => {
  invoke.mockResolvedValue(null);
  const data = new Uint8Array([9, 8]);
  await platform.writeFileRaw("D:\\폴더\\a b.html", data);
  expect(invoke).toHaveBeenCalledWith("write_file_raw", data, {
    headers: { "x-va-path": encodeURIComponent("D:\\폴더\\a b.html") },
  });
});

test("modifierShift passes through the native answer", async () => {
  invoke.mockResolvedValue(null);
  expect(await platform.modifierShift()).toBeNull();
  invoke.mockResolvedValue(true);
  expect(await platform.modifierShift()).toBe(true);
  expect(invoke).toHaveBeenCalledWith("modifier_shift");
});

test("saveDialog forwards options and returns the chosen path", async () => {
  save.mockResolvedValue("D:\\out.html");
  const opts = { defaultPath: "scene.html", filters: [{ name: "HTML", extensions: ["html"] }] };
  expect(await platform.saveDialog(opts)).toBe("D:\\out.html");
  expect(save).toHaveBeenCalledWith(expect.objectContaining(opts));
  save.mockResolvedValue(null);
  expect(await platform.saveDialog({})).toBeNull();
});

test("pickFiles offers a 3D model filter", async () => {
  open.mockResolvedValue(null);
  await platform.pickFiles();
  const filters = open.mock.calls[0][0].filters as { name: string; extensions: string[] }[];
  const threeD = filters.find((f) => f.name === "3D 모델");
  expect(threeD?.extensions).toEqual([...THREE_D_EXTENSIONS]);
});
