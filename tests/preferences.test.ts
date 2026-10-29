// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { applyPreferences, initializePreferences, parsePreferences, preferences, KEY, DEFAULTS } from "../src/settings/preferences";
test("rejects malformed preferences, invalid presets and size bounds", () => {
  for (const raw of ["no json", "null", '{"mdFont":"url(x)","mdSize":99}', '{"mdSize":12.5}']) {
    expect(parsePreferences(raw)).toEqual(DEFAULTS);
  }
});
test("persists, restores and synchronizes open windows without writing back", () => {
  localStorage.clear(); const stop = initializePreferences();
  expect(applyPreferences({ mdFont: "serif", mdSize: 22 })).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--va-md-size")).toBe("22px");
  stop(); const stop2 = initializePreferences(); expect(preferences()).toEqual({ ...DEFAULTS, mdFont: "serif", mdSize: 22 });
  const spy = vi.spyOn(localStorage, "setItem"); spy.mockClear();
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: '{"mdFont":"mono","mdSize":12}' }));
  expect(preferences()).toEqual({ ...DEFAULTS, mdFont: "mono", mdSize: 12 }); expect(spy).not.toHaveBeenCalled();
  stop2(); spy.mockRestore();
});
test("old preferences migrate without losing Markdown choices; text options validate independently", () => {
  expect(parsePreferences('{"mdFont":"serif","mdSize":20}')).toEqual({...DEFAULTS,mdFont:"serif",mdSize:20});
  expect(parsePreferences('{"textFont":"url(x)","textSize":100,"textWrap":"false"}')).toEqual(DEFAULTS);
  expect(parsePreferences('{"textFont":"system","textSize":24,"textWrap":false}')).toEqual({...DEFAULTS,textFont:"system",textSize:24,textWrap:false});
});
test("partial edits keep the other viewer settings and storage synchronization resets missing fields", () => {
  applyPreferences({...DEFAULTS,mdFont:"serif",mdSize:20},false);
  applyPreferences({textFont:"system",textSize:18,textWrap:false});
  expect(preferences()).toEqual({mdFont:"serif",mdSize:20,textFont:"system",textSize:18,textWrap:false});
  const stop=initializePreferences();
  expect(document.documentElement.style.getPropertyValue("--va-text-size")).toBe("18px");
  window.dispatchEvent(new StorageEvent("storage",{key:KEY,newValue:null})); expect(preferences()).toEqual(DEFAULTS); stop();
});
test("storage failure retains usable in-memory preference", () => {
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("full"); });
  expect(applyPreferences({ mdFont: "mono", mdSize: 20 })).toBe(false);
  expect(preferences().mdSize).toBe(20); spy.mockRestore();
});
