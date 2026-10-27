// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyTheme, currentMode, cycleTheme, initializeTheme, nextMode } from "../src/theme";

let stop = () => {};
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "system";
});
afterEach(() => { stop(); vi.restoreAllMocks(); });

test("cycles dark -> light -> system -> dark and remembers the preference", () => {
  expect(nextMode("dark")).toBe("light");
  expect(nextMode("light")).toBe("system");
  expect(nextMode("system")).toBe("dark");
  applyTheme("system");
  for (const mode of ["dark", "light", "system"]) {
    expect(cycleTheme()).toBe(mode);
    expect(document.documentElement.dataset.theme).toBe(mode);
    expect(currentMode()).toBe(mode);
    expect(localStorage.getItem("va.theme")).toBe(mode);
  }
});

test("restores the stored choice on startup and defaults to system", () => {
  stop = initializeTheme();
  expect(document.documentElement.dataset.theme).toBe("system");
  stop();
  localStorage.setItem("va.theme", "dark");
  stop = initializeTheme();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("changes in another window synchronize without echoing a storage write", () => {
  stop = initializeTheme();
  const write = vi.spyOn(Storage.prototype, "setItem");
  window.dispatchEvent(new StorageEvent("storage", { key: "va.theme", newValue: "light" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(write).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "dark" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
  expect(document.documentElement.dataset.theme).toBe("system");
  stop();
  window.dispatchEvent(new StorageEvent("storage", { key: "va.theme", newValue: "dark" }));
  expect(document.documentElement.dataset.theme).toBe("system");
});

test("continues cycling when persistent storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  stop = initializeTheme();
  expect(cycleTheme()).toBe("dark");
  expect(cycleTheme()).toBe("light");
  expect(cycleTheme()).toBe("system");
});
