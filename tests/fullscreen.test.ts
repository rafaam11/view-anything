// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const setFullscreen = vi.hoisted(() => vi.fn(async (_on: boolean) => {}));
vi.mock("../src/platform", () => ({ platform: { setFullscreen } }));
import { isFullscreen, reflectFullscreen, toggleFullscreen } from "../src/fullscreen";

beforeEach(() => { vi.clearAllMocks(); reflectFullscreen(false); });

test("toggling asks the native window and reflects the result for CSS", async () => {
  await toggleFullscreen();
  expect(setFullscreen).toHaveBeenLastCalledWith(true);
  expect(document.documentElement.dataset.fullscreen).toBe("true");
  expect(isFullscreen()).toBe(true);
  await toggleFullscreen();
  expect(setFullscreen).toHaveBeenLastCalledWith(false);
  expect(document.documentElement.dataset.fullscreen).toBeUndefined();
});

test("a refused request restores the previous state and reports the failure", async () => {
  setFullscreen.mockRejectedValueOnce(Error("denied"));
  await expect(toggleFullscreen()).rejects.toThrow("denied");
  expect(isFullscreen()).toBe(false);
});
