import { expect, test } from "vitest";
import { keyAction, TOOLBAR } from "../src/three/core/keys";

const key = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test("F fits, 1..7 pick standard views (top row and numpad)", () => {
  expect(keyAction(key("KeyF"))).toEqual({ type: "fit" });
  const views = ["front", "back", "left", "right", "top", "bottom", "iso"];
  views.forEach((view, i) => {
    expect(keyAction(key(`Digit${i + 1}`))).toEqual({ type: "view", view });
    expect(keyAction(key(`Numpad${i + 1}`))).toEqual({ type: "view", view });
  });
});

test("modifiers and other keys do nothing", () => {
  expect(keyAction(key("KeyF", { ctrlKey: true }))).toBeNull();
  expect(keyAction(key("Digit1", { altKey: true }))).toBeNull();
  expect(keyAction(key("Digit8"))).toBeNull();
  expect(keyAction(key("Digit0"))).toBeNull();
  expect(keyAction(key("KeyG"))).toBeNull();
});

test("toolbar has fit plus seven views with Korean tooltips naming the key", () => {
  expect(TOOLBAR).toHaveLength(8);
  expect(TOOLBAR.map(([, , tip]) => tip.match(/\((.)\)$/)?.[1])).toEqual(["F", "1", "2", "3", "4", "5", "6", "7"]);
});
