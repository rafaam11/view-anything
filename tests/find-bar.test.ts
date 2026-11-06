// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { findBar } from "../src/ui/find-bar";

beforeEach(() => document.body.replaceChildren());
afterEach(() => vi.useRealTimers());

const make = (extra: Partial<Parameters<typeof findBar>[0]> = {}) => {
  const step = vi.fn(), input = vi.fn(), close = vi.fn();
  const bar = findBar({ label: "문서 내 찾기", step, input, close, ...extra });
  document.body.append(bar.element);
  return { bar, step, input, close };
};
const key = (target: EventTarget, init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const labels = (el: Element) => [...el.querySelectorAll("button")].map((b) => [b.getAttribute("aria-label"), b.className]);

test("one floating bar: a search box, a live count, and icon buttons", () => {
  const { bar } = make({ maxLength: 512 });
  expect(bar.element.classList.contains("va-find")).toBe(true);
  expect(bar.element.getAttribute("role")).toBe("search");
  expect(bar.isOpen).toBe(false);
  expect(bar.input.type).toBe("search");
  expect(bar.input.placeholder).toBe("찾기");
  expect(bar.input.getAttribute("aria-label")).toBe("문서 내 찾기");
  expect(bar.input.maxLength).toBe(512);
  expect(bar.count.className).toBe("va-find-count");
  expect(bar.count.getAttribute("role")).toBe("status");
  expect(labels(bar.element)).toEqual([["이전 결과", "va-icon-button"], ["다음 결과", "va-icon-button"], ["찾기 닫기", "va-icon-button"]]);
});

test("open shows the bar with the box focused and its text selected", () => {
  const { bar } = make();
  bar.input.value = "old";
  bar.open();
  expect(bar.isOpen).toBe(true);
  expect(document.activeElement).toBe(bar.input);
});

test("Enter steps forward, Shift+Enter back, and the buttons do the same", () => {
  const { bar, step } = make();
  bar.open();
  expect(key(bar.input, { key: "Enter" }).defaultPrevented).toBe(true);
  key(bar.input, { key: "Enter", shiftKey: true });
  (bar.element.querySelector('[aria-label="이전 결과"]') as HTMLButtonElement).click();
  (bar.element.querySelector('[aria-label="다음 결과"]') as HTMLButtonElement).click();
  expect(step.mock.calls).toEqual([[false], [true], [true], [false]]);
});

test("the Enter that commits a Korean syllable does not search", () => {
  const { bar, step } = make();
  bar.open();
  key(bar.input, { key: "Enter", isComposing: true });
  key(bar.input, { key: "Process", keyCode: 229 } as KeyboardEventInit);
  expect(step).not.toHaveBeenCalled();
});

test("typing reaches the viewer after a pause; an Enter before that applies it instead of stepping", () => {
  vi.useFakeTimers();
  const { bar, step, input } = make({ debounce: 100 });
  bar.open();
  bar.input.value = "ab";
  bar.input.dispatchEvent(new Event("input"));
  expect(input).not.toHaveBeenCalled();
  key(bar.input, { key: "Enter" });
  expect(input).toHaveBeenCalledWith("ab");
  expect(step).not.toHaveBeenCalled();
  bar.input.value = "abc";
  bar.input.dispatchEvent(new Event("input"));
  vi.advanceTimersByTime(100);
  expect(input).toHaveBeenLastCalledWith("abc");
  key(bar.input, { key: "Enter" });
  expect(step).toHaveBeenCalledWith(false);
});

test("without a pause the viewer hears each change at once", () => {
  const { bar, input } = make();
  bar.input.value = "x";
  bar.input.dispatchEvent(new Event("input"));
  expect(input).toHaveBeenCalledWith("x");
});

test("Esc in the box or the close button closes it, clears it and tells the viewer", () => {
  const { bar, close } = make();
  bar.open();
  bar.input.value = "q"; bar.count.textContent = "1/2";
  expect(key(bar.input, { key: "Escape" }).defaultPrevented).toBe(true);
  expect(bar.isOpen).toBe(false);
  expect(bar.input.value).toBe("");
  expect(bar.count.textContent).toBe("");
  bar.open();
  (bar.element.querySelector('[aria-label="찾기 닫기"]') as HTMLButtonElement).click();
  expect(bar.isOpen).toBe(false);
  expect(close).toHaveBeenCalledTimes(2);
});
