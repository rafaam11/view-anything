// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { initializeDialogInput, showDialog } from "../src/ui/dialog";

let stop: () => void = () => {};
afterEach(() => { stop(); stop = () => {}; document.body.replaceChildren(); });

const discard = (extra: Partial<Parameters<typeof showDialog<"discard" | "cancel">>[0]> = {}) => showDialog<"discard" | "cancel">({
  message: "저장하지 않은 변경 내용을 버릴까요?",
  kind: "warning",
  buttons: [{ label: "버리기", value: "discard", variant: "danger" }, { label: "취소", value: "cancel" }],
  defaultValue: "cancel",
  cancelValue: "cancel",
  ...extra,
});
/** The top (last opened) message dialog. */
const open = () => [...document.querySelectorAll<HTMLDialogElement>("dialog.va-message[open]")].at(-1)!;
const button = (label: string) => [...open().querySelectorAll("button")].find((b) => b.textContent === label)!;

test("the safe answer has the focus and Esc gives the cancel value", async () => {
  const answer = discard();
  expect(document.activeElement).toBe(button("취소"));
  open().dispatchEvent(new Event("cancel", { cancelable: true }));
  await expect(answer).resolves.toBe("cancel");
  expect(document.querySelector("dialog")).toBeNull();
});

test("a pressed button answers with its value and the dialog goes away", async () => {
  const answer = discard();
  expect(button("버리기").className).toBe("va-btn va-btn-danger");
  expect(button("취소").className).toBe("va-btn");
  button("버리기").click();
  await expect(answer).resolves.toBe("discard");
  expect(document.querySelector("dialog")).toBeNull();
});

test("closing it from outside counts as cancel", async () => {
  const answer = discard();
  open().close();
  await expect(answer).resolves.toBe("cancel");
});

test("title, message and detail go in as text and label the dialog", async () => {
  const answer = discard({ title: "<b>제목</b>", detail: "C:\\\\a<i>.md" });
  const d = open();
  expect(d.querySelector("b, i")).toBeNull();
  expect(d.getAttribute("role")).toBe("alertdialog");
  const title = document.getElementById(d.getAttribute("aria-labelledby")!)!;
  expect(title.textContent).toBe("<b>제목</b>");
  const described = d.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)!.textContent);
  expect(described).toEqual(["저장하지 않은 변경 내용을 버릴까요?", "C:\\\\a<i>.md"]);
  button("취소").click();
  await answer;
});

test("without a title the message names the dialog; information is a plain dialog", async () => {
  const answer = showDialog({ message: "최근 목록에서 뺐습니다", buttons: [{ label: "확인", value: "ok", variant: "primary" }], defaultValue: "ok", cancelValue: "ok" });
  const d = open();
  expect(d.getAttribute("role")).toBe("dialog");
  expect(document.getElementById(d.getAttribute("aria-labelledby")!)!.textContent).toBe("최근 목록에서 뺐습니다");
  expect(d.querySelector(".va-dialog-title")).toBeNull();
  expect(button("확인").className).toBe("va-btn va-btn-primary");
  button("확인").click();
  await expect(answer).resolves.toBe("ok");
});

test("focus goes back to where it was, also after two stacked dialogs", async () => {
  const before = document.createElement("button"); document.body.append(before); before.focus();
  const first = discard();
  const firstCancel = button("취소");
  const second = discard({ className: "second" });
  expect(document.querySelectorAll("dialog.va-message[open]")).toHaveLength(2);
  expect(document.activeElement).toBe(button("취소"));
  button("버리기").click();
  await expect(second).resolves.toBe("discard");
  expect(document.activeElement).toBe(firstCancel);
  firstCancel.click();
  await expect(first).resolves.toBe("cancel");
  expect(document.activeElement).toBe(before);
});

test("an extra class marks a dialog for its caller", async () => {
  const answer = discard({ className: "va-update-dialog" });
  expect(open().className).toBe("va-dialog va-message va-update-dialog");
  button("취소").click();
  await answer;
});

test("while a message is open, app shortcuts never run and only dialog keys act", async () => {
  stop = initializeDialogInput();
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut, true);
  try {
    const answer = discard();
    const key = (init: KeyboardEventInit, target: EventTarget = document.activeElement!) => {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };
    expect(key({ key: "s", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: "o", ctrlKey: true }, window).defaultPrevented).toBe(true);
    expect(key({ key: "Tab" }).defaultPrevented).toBe(false);
    expect(key({ key: "Tab", shiftKey: true }).defaultPrevented).toBe(false);
    expect(key({ key: "Escape" }).defaultPrevented).toBe(false);
    expect(key({ key: "Enter" }).defaultPrevented).toBe(false);
    expect(key({ key: "Enter", repeat: true }).defaultPrevented).toBe(true);
    expect(key({ key: " ", repeat: true }).defaultPrevented).toBe(true);
    expect(key({ key: "F11" }).defaultPrevented).toBe(true);
    expect(shortcut).not.toHaveBeenCalled();
    // ←/→ move between the footer buttons.
    expect(key({ key: "ArrowLeft" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("버리기"));
    key({ key: "ArrowRight" });
    expect(document.activeElement).toBe(button("취소"));
    button("취소").click();
    await answer;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    expect(shortcut).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("keydown", shortcut, true);
  }
});

test("the app installs the dialog key guard before any shortcut listener", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync("src/main.ts", "utf8");
  const guard = main.indexOf("initializeDialogInput();");
  expect(guard).toBeGreaterThan(main.indexOf("initializeUpdateInput();"));
  expect(guard).toBeLessThan(main.indexOf("mountTitlebar();"));
  expect(guard).toBeLessThan(main.indexOf('addEventListener("keydown"'));
});

test("after a click on its text the dialog keeps the keyboard: Esc, Tab, Enter and copying work", async () => {
  stop = initializeDialogInput();
  const answer = discard({ detail: "C:/Users/me/report.md" });
  const d = open();
  // A click on plain text focuses the nearest focusable ancestor: the dialog itself.
  expect(d.tabIndex).toBe(-1);
  d.focus();
  const send = (init: KeyboardEventInit, target: EventTarget) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  const detail = d.querySelector(".va-dialog-detail")!;
  expect(send({ key: "c", ctrlKey: true }, detail).defaultPrevented).toBe(false);
  expect(send({ key: "a", ctrlKey: true }, d).defaultPrevented).toBe(false);
  expect(send({ key: "Tab" }, d).defaultPrevented).toBe(false);
  expect(send({ key: "Escape" }, d).defaultPrevented).toBe(false);
  expect(send({ key: "s", ctrlKey: true }, d).defaultPrevented).toBe(true);
  expect(send({ key: "c", ctrlKey: true }, document.body).defaultPrevented).toBe(true);
  button("취소").click();
  await answer;
});
