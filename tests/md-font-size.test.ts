// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createWheelStepper, sizeShortcut, stepMdSize } from "../src/md/font-size";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { ctrlKey: true, ...init });

test("sizes stay inside the range the setting accepts", () => {
  expect(stepMdSize(16, 1)).toBe(17);
  expect(stepMdSize(24, 1)).toBe(24);
  expect(stepMdSize(12, -1)).toBe(12);
});

test("one mouse wheel notch is one step, and wheel up enlarges", () => {
  const step = createWheelStepper();
  expect(step(-100)).toBe(1);
  expect(step(100)).toBe(-1);
});

test("small touchpad deltas add up, and turning around starts over", () => {
  const step = createWheelStepper();
  expect(step(20)).toBe(0);
  expect(step(20)).toBe(0);
  expect(step(-20)).toBe(0); // the 40 collected downwards no longer count
  expect(step(-20)).toBe(0);
  expect(step(-20)).toBe(1);
  expect(step(-20)).toBe(0); // and a step spends what was collected
});

test("the shortcuts work with and without Shift where the layout needs it, and on the numpad", () => {
  expect(sizeShortcut(key({ key: "=", code: "Equal" }))).toBe(1);
  expect(sizeShortcut(key({ key: "+", code: "Equal", shiftKey: true }))).toBe(1);
  expect(sizeShortcut(key({ key: "+", code: "NumpadAdd" }))).toBe(1);
  expect(sizeShortcut(key({ key: "-", code: "Minus" }))).toBe(-1);
  expect(sizeShortcut(key({ key: "-", code: "NumpadSubtract" }))).toBe(-1);
  expect(sizeShortcut(key({ key: "0", code: "Digit0" }))).toBe(0);
  expect(sizeShortcut(key({ key: "0", code: "Numpad0" }))).toBe(0);
});

test("other keys and modifiers are left alone", () => {
  expect(sizeShortcut(key({ key: "=", ctrlKey: false }))).toBeNull();
  expect(sizeShortcut(key({ key: "=", altKey: true }))).toBeNull();
  expect(sizeShortcut(key({ key: "_", code: "Minus", shiftKey: true }))).toBeNull();
  expect(sizeShortcut(key({ key: ")", code: "Digit0", shiftKey: true }))).toBeNull();
  expect(sizeShortcut(key({ key: "f", code: "KeyF" }))).toBeNull();
});
