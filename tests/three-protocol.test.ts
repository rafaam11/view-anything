import { expect, test } from "vitest";
import { formatProgress, formatStatus, progressPercent, progressThrottle, type Phase } from "../src/three/worker/protocol";

test("progressPercent: rounds down, clamps, unknown total is null", () => {
  expect(progressPercent(0, 200)).toBe(0);
  expect(progressPercent(199, 200)).toBe(99);
  expect(progressPercent(200, 200)).toBe(100);
  expect(progressPercent(300, 200)).toBe(100);
  expect(progressPercent(-5, 200)).toBe(0);
  expect(progressPercent(10, 0)).toBeNull();
  expect(progressPercent(10, NaN)).toBeNull();
});

test("progressThrottle: emits on percent or phase change and on completion only", () => {
  const seen: [Phase, number, number][] = [];
  const p = progressThrottle((phase, l, t) => seen.push([phase, l, t]));
  p("read", 0, 1000); // 0%
  p("read", 5, 1000); // still 0%
  p("read", 9, 1000); // still 0%
  p("read", 10, 1000); // 1%
  p("read", 11, 1000); // 1%
  p("read", 1000, 1000); // 100%
  p("read", 1000, 1000); // duplicate
  p("parse", 0, 0); // new phase
  p("parse", 0, 0); // duplicate
  expect(seen).toEqual([
    ["read", 0, 1000],
    ["read", 10, 1000],
    ["read", 1000, 1000],
    ["parse", 0, 0],
  ]);
});

test("progressThrottle: unknown total emits every 4 MiB", () => {
  const seen: number[] = [];
  const p = progressThrottle((_ph, l) => seen.push(l));
  const MB = 1 << 20;
  for (let l = 0; l <= 10 * MB; l += MB / 2) p("read", l, 0);
  expect(seen).toEqual([0, 4 * MB, 8 * MB]);
});

test("formatProgress: korean phase label with percent or size", () => {
  expect(formatProgress("read", 50, 200)).toBe("읽는 중 25%");
  expect(formatProgress("read", 3 * 1024 * 1024, 0)).toBe("읽는 중 3.0 MB");
  expect(formatProgress("parse", 0, 0)).toBe("해석 중");
  expect(formatProgress("parse", 1, 4)).toBe("해석 중 25%");
});

test("formatProgress: upload phase counts chunks", () => {
  expect(formatProgress("upload", 3, 6)).toBe("GPU 업로드 3/6");
  expect(formatProgress("read", 1, 4, "워커 미사용")).toBe("읽는 중 25% · 워커 미사용");
});

test("formatStatus: triangle count, seconds, worker note", () => {
  expect(formatStatus(6_000_000, 2400, true)).toBe("삼각형 6,000,000 · 2.4초");
  expect(formatStatus(12, 51, false)).toBe("삼각형 12 · 0.1초 · 워커 미사용");
});
