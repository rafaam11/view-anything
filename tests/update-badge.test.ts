// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { confirmRestart } from "../src/update/badge";

afterEach(() => document.body.replaceChildren());

const open = () => document.querySelector<HTMLDialogElement>("dialog.va-update-dialog[open]")!;
const labels = () => [...open().querySelectorAll("button")].map((b) => b.textContent);

// scripts/desktop/windows.mjs finds the dialog by .va-update-dialog, the 재시작/취소 buttons and the warning text.
test("the restart question is an app message with cancel focused", async () => {
  const answer = confirmRestart(false);
  expect(open().classList.contains("va-message")).toBe(true);
  expect(open().querySelector(".va-dialog-title")!.textContent).toBe("업데이트 설치");
  expect(open().querySelector(".va-dialog-message")!.textContent).toBe("지금 재시작하여 업데이트를 설치할까요?");
  expect(open().querySelector(".va-dialog-detail")).toBeNull();
  expect(labels()).toEqual(["재시작", "취소"]);
  expect(open().querySelector("button")!.className).toBe("va-btn va-btn-primary");
  expect((document.activeElement as HTMLElement).textContent).toBe("취소");
  open().dispatchEvent(new Event("cancel", { cancelable: true }));
  await expect(answer).resolves.toBe(false);
});

test("with unsaved work the restart turns red and says what is lost", async () => {
  const answer = confirmRestart(true);
  expect(open().querySelector(".va-dialog-detail")!.textContent).toBe("저장하지 않은 변경과 진행 중인 작업은 사라집니다. 저장하려면 취소하세요.");
  expect(open().querySelector("button")!.className).toBe("va-btn va-btn-danger");
  [...open().querySelectorAll("button")].find((b) => b.textContent === "재시작")!.click();
  await expect(answer).resolves.toBe(true);
});
