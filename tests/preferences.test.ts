// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { applyPreferences, initializePreferences, parsePreferences, preferences, KEY } from "../src/settings/preferences";
test("rejects malformed preferences, invalid presets and size bounds", () => {
  for (const raw of ["no json", "null", '{"mdFont":"url(x)","mdSize":99}', '{"mdSize":12.5}']) {
    expect(parsePreferences(raw)).toEqual({ mdFont: "system", mdSize: 16 });
  }
});
test("persists, restores and synchronizes open windows without writing back", () => {
  localStorage.clear(); const stop = initializePreferences();
  expect(applyPreferences({ mdFont: "serif", mdSize: 22 })).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--va-md-size")).toBe("22px");
  stop(); const stop2 = initializePreferences(); expect(preferences()).toEqual({ mdFont: "serif", mdSize: 22 });
  const spy = vi.spyOn(localStorage, "setItem"); spy.mockClear();
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: '{"mdFont":"mono","mdSize":12}' }));
  expect(preferences()).toEqual({ mdFont: "mono", mdSize: 12 }); expect(spy).not.toHaveBeenCalled();
  stop2(); spy.mockRestore();
});
test("storage failure retains usable in-memory preference", () => {
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("full"); });
  expect(applyPreferences({ mdFont: "mono", mdSize: 20 })).toBe(false);
  expect(preferences().mdSize).toBe(20); spy.mockRestore();
});
