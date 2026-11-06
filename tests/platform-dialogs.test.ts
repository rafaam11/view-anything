// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const calls: string[] = [];
const win = {
  isMinimized: vi.fn(async () => false),
  unminimize: vi.fn(async () => { calls.push("unminimize"); }),
  setFocus: vi.fn(async () => { calls.push("focus"); }),
  onCloseRequested: vi.fn(),
};
const ask = vi.fn(), message = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, message, open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));

const { platform } = await import("../src/platform");

beforeEach(() => {
  calls.length = 0;
  win.isMinimized.mockReset().mockResolvedValue(false);
  win.setFocus.mockClear(); win.unminimize.mockClear(); win.onCloseRequested.mockReset();
});
afterEach(() => {
  expect(ask).not.toHaveBeenCalled();
  expect(message).not.toHaveBeenCalled();
  document.body.replaceChildren();
});

/** Waits for the in-app dialog, then returns its button labels and a way to answer. */
async function dialog() {
  await vi.waitFor(() => expect(document.querySelector("dialog.va-message[open]")).not.toBeNull());
  const d = document.querySelector<HTMLDialogElement>("dialog.va-message[open]")!;
  const buttons = [...d.querySelectorAll("button")];
  return {
    d,
    labels: buttons.map((b) => b.textContent),
    focused: (document.activeElement as HTMLElement).textContent,
    press: (label: string) => buttons.find((b) => b.textContent === label)!.click(),
    escape: () => d.dispatchEvent(new Event("cancel", { cancelable: true })),
  };
}

test("confirm asks inside the app with cancel as the default", async () => {
  const answer = platform.confirm("내보낼까요?", "내보내기");
  const d = await dialog();
  expect(d.labels).toEqual(["내보내기", "취소"]);
  expect(d.focused).toBe("취소");
  expect(d.d.dataset.kind).toBe("warning");
  d.press("내보내기");
  await expect(answer).resolves.toBe(true);
  const plain = platform.confirm("계속할까요?");
  const p = await dialog();
  expect(p.labels).toEqual(["계속", "취소"]);
  p.escape();
  await expect(plain).resolves.toBe(false);
});

test("discarding offers one red button and cancel, with cancel focused", async () => {
  const answer = platform.confirmDiscard("저장하지 않은 변경 내용을 버릴까요?");
  const d = await dialog();
  expect(d.labels).toEqual(["버리기", "취소"]);
  expect(d.d.querySelector("button")!.className).toBe("va-btn va-btn-danger");
  expect(d.focused).toBe("취소");
  d.escape();
  await expect(answer).resolves.toBe(false);
  const close = platform.confirmDiscard("버리고 닫을까요?", "닫기");
  const c = await dialog();
  expect(c.labels).toEqual(["닫기", "취소"]);
  c.press("닫기");
  await expect(close).resolves.toBe(true);
});

test("a dangerous action names both answers; the safe one is the default", async () => {
  const answer = platform.confirmDanger("같은 이름의 파일을 바꿀까요?", "바꾸기");
  const d = await dialog();
  expect(d.labels).toEqual(["바꾸기", "취소"]);
  expect(d.focused).toBe("취소");
  d.press("취소");
  await expect(answer).resolves.toBe(false);
  const own = platform.confirmDanger("미리보기를 버리고 저장할까요?", "버리고 저장", "돌아가기");
  const o = await dialog();
  expect(o.labels).toEqual(["버리고 저장", "돌아가기"]);
  o.press("버리고 저장");
  await expect(own).resolves.toBe(true);
});

test("notices and errors have one OK button and their own kind", async () => {
  const info = platform.notice("다른 창이 응답하지 않았습니다.");
  const i = await dialog();
  expect(i.labels).toEqual(["확인"]);
  expect(i.d.dataset.kind).toBe("info");
  i.press("확인");
  await info;
  const warning = platform.notice("파일이 바뀌었습니다.", "warning");
  const w = await dialog();
  expect(w.d.dataset.kind).toBe("warning");
  w.escape();
  await warning;
  const error = platform.alert("Error: 저장할 수 없습니다");
  const e = await dialog();
  expect(e.d.dataset.kind).toBe("error");
  expect(e.d.getAttribute("role")).toBe("alertdialog");
  e.press("확인");
  await error;
});

test("a minimized window comes back before it asks", async () => {
  win.isMinimized.mockResolvedValue(true);
  const answer = platform.confirmDiscard("버릴까요?");
  const d = await dialog();
  expect(calls).toEqual(["unminimize", "focus"]);
  d.press("취소");
  await answer;
  await platform.bringToFront();
  expect(win.unminimize).toHaveBeenCalledTimes(2);
});

test("a window that cannot be raised still asks", async () => {
  win.isMinimized.mockRejectedValue(new Error("not allowed"));
  const answer = platform.alert("실패");
  const d = await dialog();
  d.press("확인");
  await expect(answer).resolves.toBeUndefined();
});

test("a second close request while the first one asks is ignored", async () => {
  let handler: (e: { preventDefault(): void }) => Promise<void> = async () => {};
  win.onCloseRequested.mockImplementation(async (h) => { handler = h; });
  const allow = vi.fn(() => platform.confirmDiscard("버리고 닫을까요?", "닫기"));
  await platform.onCloseRequested(allow);
  const first = { preventDefault: vi.fn() }, second = { preventDefault: vi.fn() };
  const asking = handler(first);
  const d = await dialog();
  await handler(second);
  expect(second.preventDefault).toHaveBeenCalled();
  expect(allow).toHaveBeenCalledOnce();
  expect(document.querySelectorAll("dialog.va-message")).toHaveLength(1);
  d.press("취소");
  await asking;
  expect(first.preventDefault).toHaveBeenCalled();
});

test("a failing close check still asks in the app, and the answer decides", async () => {
  let handler: (e: { preventDefault(): void }) => Promise<void> = async () => {};
  win.onCloseRequested.mockImplementation(async (h) => { handler = h; });
  await platform.onCloseRequested(async () => { throw new Error("boom"); });
  // The dialog plugin replaces window.confirm with an async IPC call (a truthy Promise): never rely on it.
  const confirm = vi.fn(() => Promise.resolve(false));
  vi.stubGlobal("confirm", confirm);
  try {
    const kept = { preventDefault: vi.fn() };
    const asking = handler(kept);
    const d = await dialog();
    expect(d.labels).toEqual(["닫기", "취소"]);
    d.press("취소");
    await asking;
    expect(kept.preventDefault).toHaveBeenCalled();
    const closed = { preventDefault: vi.fn() };
    const again = handler(closed);
    (await dialog()).press("닫기");
    await again;
    expect(closed.preventDefault).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
