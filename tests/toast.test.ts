// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "../src/ui/toast";

beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.useRealTimers(); });

const shown = () => [...document.querySelectorAll<HTMLElement>(".va-toast")];

test("one polite live region shows the latest message as text", () => {
  toast("<b>저장했습니다</b>");
  toast("이미지를 복사했습니다");
  expect(shown()).toHaveLength(1);
  const t = shown()[0];
  expect(t.getAttribute("role")).toBe("status");
  expect(t.getAttribute("aria-live")).toBe("polite");
  expect(t.textContent).toBe("이미지를 복사했습니다");
  expect(t.querySelector("b")).toBeNull();
  expect(t.hidden).toBe(false);
});

test("it stays long enough to read: 2 s plus 60 ms a character, at most 6 s", () => {
  toast("저장했습니다"); // 6 characters: 2360 ms
  vi.advanceTimersByTime(2359);
  expect(shown()[0].hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(shown()[0].hidden).toBe(true);
  toast("가".repeat(200));
  vi.advanceTimersByTime(5999);
  expect(shown()[0].hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(shown()[0].hidden).toBe(true);
});

test("a new message restarts the time and a caller may set its own", () => {
  toast("하나");
  vi.advanceTimersByTime(2000);
  toast("둘", { timeout: 500 });
  vi.advanceTimersByTime(499);
  expect(shown()[0].textContent).toBe("둘");
  expect(shown()[0].hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(shown()[0].hidden).toBe(true);
});
