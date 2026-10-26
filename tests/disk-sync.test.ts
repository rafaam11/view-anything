import { expect, test } from "vitest";
import { beforeWrite, bytesEqual, diskState, shouldReloadOnFocus } from "../src/md/viewer-state";

const b = (s: string) => new TextEncoder().encode(s);

test("bytesEqual compares length and content", () => {
  expect(bytesEqual(b("abc"), b("abc"))).toBe(true);
  expect(bytesEqual(b("abc"), b("abd"))).toBe(false);
  expect(bytesEqual(b("abc"), b("abcd"))).toBe(false);
  expect(bytesEqual(b(""), b(""))).toBe(true);
});

test("diskState reports same, changed or missing", () => {
  expect(diskState(b("x"), b("x"))).toBe("same");
  expect(diskState(b("x"), b("y"))).toBe("changed");
  expect(diskState(b("x"), null)).toBe("missing");
});

test("beforeWrite asks before overwriting bytes another program changed", () => {
  expect(beforeWrite(b("mine"), b("mine"))).toBe("write");
  expect(beforeWrite(b("mine"), b("agent edit"))).toBe("confirm-overwrite");
  // A deleted file loses nothing by being written again.
  expect(beforeWrite(b("mine"), null)).toBe("write");
});

test("shouldReloadOnFocus only in idle read mode with changed bytes", () => {
  const known = b("old");
  expect(shouldReloadOnFocus({ mode: "read", busy: false }, known, b("new"))).toBe(true);
  expect(shouldReloadOnFocus({ mode: "read", busy: false }, known, b("old"))).toBe(false);
  expect(shouldReloadOnFocus({ mode: "read", busy: false }, known, null)).toBe(false);
  expect(shouldReloadOnFocus({ mode: "edit", busy: false }, known, b("new"))).toBe(false);
  expect(shouldReloadOnFocus({ mode: "read", busy: true }, known, b("new"))).toBe(false);
});
