// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { Banner } from "../src/three/core/banner";

const buttons = (b: Banner) => [...b.root.querySelectorAll("button")];

test("an error is an alert; information and warnings are polite status", () => {
  const b = new Banner();
  expect(b.root.classList.contains("va-banner")).toBe(true);
  expect(b.root.hidden).toBe(true);
  b.show("a.step: 파일이 너무 크거나 손상됨");
  expect(b.root.dataset.kind).toBe("error");
  expect(b.root.getAttribute("role")).toBe("alert");
  b.info("파일을 불러오는 중에는 내보낼 수 없습니다.");
  expect(b.root.dataset.kind).toBe("info");
  expect(b.root.getAttribute("role")).toBe("status");
  b.show("엣지 표시를 껐습니다.", undefined, "warning");
  expect(b.root.dataset.kind).toBe("warning");
  expect(b.root.getAttribute("role")).toBe("status");
  expect(b.root.hidden).toBe(false);
});

test("text goes in as text and the close button is an icon named 닫기", () => {
  const b = new Banner();
  b.show("<img src=x>");
  expect(b.root.querySelector("img")).toBeNull();
  expect(b.root.textContent).toContain("<img src=x>");
  const close = buttons(b).find((x) => x.getAttribute("aria-label") === "닫기")!;
  expect(close.className).toBe("va-icon-button");
  close.click();
  expect(b.root.hidden).toBe(true);
});

test("one action button runs once and closes the banner", () => {
  const b = new Banner();
  const run = vi.fn();
  b.show("실패", { label: "다시 시도", run });
  const action = buttons(b).find((x) => x.textContent === "다시 시도")!;
  expect(action.classList.contains("va-btn")).toBe(true);
  action.click();
  expect(run).toHaveBeenCalledOnce();
  expect(b.root.hidden).toBe(true);
  b.info("안내");
  expect(buttons(b).map((x) => x.getAttribute("aria-label") ?? x.textContent)).toEqual(["닫기"]);
});

test("the banner is shared code: no Tauri, so the exported page can use it", () => {
  const source = readFileSync("src/three/core/banner.ts", "utf8");
  expect(source).not.toMatch(/platform|@tauri-apps/);
});
