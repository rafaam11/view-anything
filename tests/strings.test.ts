import { expect, test } from "vitest";
import { CONFLICT_READ_MODE, CONFLICT_RELOAD, DISCARD, DISCARD_CLOSE, DISCARD_RELOAD, errorMessage } from "../src/ui/strings";

test("an error reads as a sentence, without the Error: prefix", () => {
  expect(errorMessage(new Error("denied"))).toBe("denied");
  expect(errorMessage(new TypeError("bad input"))).toBe("bad input");
  expect(errorMessage("Error: boom")).toBe("boom");
  expect(errorMessage("disk full")).toBe("disk full");
  expect(errorMessage(new Error(""))).toBe("알 수 없는 오류");
});

test("discard and conflict messages share one wording", () => {
  for (const text of [DISCARD, DISCARD_CLOSE, DISCARD_RELOAD]) expect(text.startsWith("저장하지 않은 변경 내용을 버")).toBe(true);
  expect(DISCARD_CLOSE).toContain("닫을까요");
  expect(DISCARD_RELOAD).toContain("다시 읽을까요");
  for (const text of [CONFLICT_RELOAD, CONFLICT_READ_MODE]) {
    expect(text).toContain("저장하지 않았습니다");
    expect(text).toContain("편집 내용은 그대로 있습니다");
  }
});
