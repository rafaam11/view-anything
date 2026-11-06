// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ disk: new Uint8Array(), copy: new Uint8Array(), close: async () => true, alerts: [] as string[] }));
/** A tiny two-way CP949 table standing in for the Rust codec: ASCII passes through, four syllables are known. */
const cp = vi.hoisted(() => {
  const chars: Record<string, number[]> = { "이": [0xc0, 0xcc], "름": [0xb8, 0xa7], "값": [0xb0, 0xaa], "가": [0xb0, 0xa1], "나": [0xb3, 0xaa] };
  const encode = (text: string) => Uint8Array.from([...text].flatMap((ch) => {
    if (ch.charCodeAt(0) < 0x80) return [ch.charCodeAt(0)];
    if (!chars[ch]) throw new Error("CP949로 저장할 수 없는 문자");
    return chars[ch];
  }));
  const decode = (bytes: Uint8Array) => {
    let out = "";
    for (let i = 0; i < bytes.length;) {
      if (bytes[i] < 0x80) { out += String.fromCharCode(bytes[i++]); continue; }
      const ch = Object.keys(chars).find((k) => chars[k][0] === bytes[i] && chars[k][1] === bytes[i + 1]);
      if (!ch) throw new Error("CP949 디코드 실패");
      out += ch; i += 2;
    }
    return out;
  };
  return { encode, decode };
});
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.disk.length,
  readFileRaw: async () => state.disk.slice().buffer,
  decodeCp949: async (bytes: Uint8Array) => cp.decode(bytes),
  encodeCp949: async (text: string) => cp.encode(text),
  writeFileChecked: async (_path: string, expected: Uint8Array, bytes: Uint8Array) => { if (String(state.disk) !== String(expected)) return false; state.disk = bytes.slice(); return true; },
  saveDialog: async () => "copy.csv", writeFileNew: async (_path: string, bytes: Uint8Array) => { state.copy = bytes.slice(); },
  setWindowTitle: async () => {},
  onCloseRequested: async (fn: () => Promise<boolean>) => { state.close = fn; },
  confirmDiscard: async () => false,
  alert: async (message: string) => { state.alerts.push(message); },
} }));
vi.mock("../src/update/guard", () => ({ registerUpdateGuard: () => {} }));
import viewer from "../src/data/csv-viewer";
import { textSettings } from "../src/settings/document";

const encode = (s: string) => new TextEncoder().encode(s);
const controls = (root: HTMLElement) => ["편집", "저장", "다른 이름으로 저장", "다시 읽기", "이전 페이지", "다음 페이지", "이전 열", "다음 열"].map(label => [...root.querySelectorAll("button")].find(b => b.textContent === label)!);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

test("CSV edits preserve untouched bytes and external conflicts retain local changes", async () => {
  state.disk = encode('\ufeff"name",value\r\nalpha,1\n'); state.alerts = [];
  const root = document.createElement("div");
  await viewer.mount(root, "test.csv");
  const buttons = controls(root);
  buttons[0].click(); await settle();
  const cells = root.querySelectorAll("textarea");
  cells[2].value = "beta"; cells[2].dispatchEvent(new Event("input"));
  buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode('\ufeff"name",value\r\nbeta,1\n'));
  expect(document.querySelector(".va-toast:not([hidden])")?.textContent).toBe("저장했습니다");
  const edited = root.querySelectorAll("textarea")[2];
  edited.value = "local"; edited.dispatchEvent(new Event("input"));
  state.disk = encode("external\n");
  buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode("external\n"));
  expect(edited.value).toBe("local");
  expect(state.alerts).toHaveLength(1);
  buttons[2].click(); await settle();
  expect(document.querySelector(".va-toast:not([hidden])")?.textContent).toBe("복사본을 저장했습니다. 이 창에서는 원본을 계속 편집합니다.");
  expect(state.copy).toEqual(encode('\ufeff"name",value\r\nlocal,1\n'));
  expect(state.disk).toEqual(encode("external\n"));
  expect(await state.close()).toBe(false);
});

test("edits survive page navigation and save together", async () => {
  state.disk = encode(Array.from({ length: 101 }, (_, i) => `row${i},value`).join("\r\n"));
  const root = document.createElement("div"); await viewer.mount(root, "pages.csv");
  const buttons = controls(root); buttons[0].click(); await settle();
  expect(root.querySelectorAll("textarea")).toHaveLength(200);
  const first = root.querySelectorAll("textarea")[0]; first.value = "first"; first.dispatchEvent(new Event("input"));
  buttons[5].click();
  expect(root.querySelectorAll("textarea")).toHaveLength(2);
  const last = root.querySelectorAll("textarea")[0]; last.value = "last"; last.dispatchEvent(new Event("input"));
  buttons[1].click(); await settle();
  const text = new TextDecoder().decode(state.disk);
  expect(text.startsWith("first,value\r\n")).toBe(true);
  expect(text.endsWith("last,value")).toBe(true);
});

test("very wide CSV rows are paged by column and keep changes across pages", async () => {
  state.disk = encode(Array.from({ length: 25 }, (_, i) => `v${i}`).join(","));
  const root = document.createElement("div"); await viewer.mount(root, "wide.csv");
  const buttons = controls(root); buttons[0].click(); await settle();
  expect(root.querySelectorAll("textarea")).toHaveLength(10);
  const first = root.querySelectorAll("textarea")[0]; first.value = "changed"; first.dispatchEvent(new Event("input"));
  buttons[7].click();
  expect(root.querySelectorAll("textarea")).toHaveLength(10);
  expect(root.querySelectorAll("textarea")[0].value).toBe("v10");
  buttons[1].click(); await settle();
  expect(new TextDecoder().decode(state.disk).startsWith("changed,v1,")).toBe(true);
});

test("a CP949 CSV asks for the encoding setting, then opens and saves losslessly", async () => {
  state.disk = cp.encode("이름,값\r\n가,1\n"); state.alerts = [];
  const root = document.createElement("div");
  await viewer.mount(root, "excel.csv");
  expect(root.querySelector('[role="status"]')!.textContent).toContain("CP949");
  expect(root.querySelector("table")).toBeNull();
  expect(controls(root)[0].disabled).toBe(true);
  await textSettings()!.changeEncoding("cp949"); await settle();
  expect(root.querySelector("table")!.textContent).toContain("이름");
  expect(controls(root)[0].disabled).toBe(false);
  controls(root)[0].click(); await settle();
  const cell = root.querySelectorAll("textarea")[2]; cell.value = "나"; cell.dispatchEvent(new Event("input"));
  controls(root)[1].click(); await settle();
  expect(state.disk).toEqual(cp.encode("이름,값\r\n나,1\n"));
  expect(state.alerts).toEqual([]);
});

test("a file that stops parsing after a reload closes editing instead of saving stale cells", async () => {
  state.disk = encode("a,b\n1,2\n"); state.alerts = [];
  const root = document.createElement("div");
  await viewer.mount(root, "late.csv");
  const buttons = controls(root); buttons[0].click(); await settle();
  expect(root.querySelectorAll("textarea")).toHaveLength(4);
  state.disk = encode('"broken\n');
  buttons[3].click(); await settle(); // 다시 읽기: nothing was edited, so no confirmation
  expect(root.querySelectorAll("textarea")).toHaveLength(0);
  expect(buttons[0].textContent).toBe("편집");
  expect(buttons[0].disabled).toBe(true);
  expect(root.querySelector('[role="status"]')!.textContent).toContain("CSV");
  expect(state.disk).toEqual(encode('"broken\n'));
});

test("switching back to UTF clears the CP949 note", async () => {
  state.disk = encode("a,b\n1,2\n");
  const root = document.createElement("div");
  await viewer.mount(root, "ascii.csv");
  await textSettings()!.changeEncoding("cp949"); await settle();
  expect(root.querySelector('[role="status"]')!.textContent).toContain("CP949로 읽음");
  await textSettings()!.changeEncoding("utf"); await settle();
  expect(root.querySelector('[role="status"]')!.textContent).not.toContain("CP949");
});
