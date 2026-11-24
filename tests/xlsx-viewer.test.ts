// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { makeXlsx, STYLES } from "./xlsx-fixture";

const state = vi.hoisted(() => ({ bytes: new Uint8Array(), size: -1 }));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.size >= 0 ? state.size : state.bytes.length,
  readFileRaw: async () => state.bytes.slice().buffer,
  setWindowTitle: async () => {},
} }));
import viewer from "../src/office/xlsx/viewer";

async function mount(bytes: Uint8Array) {
  state.bytes = bytes; state.size = -1;
  document.body.replaceChildren();
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "C:/book.xlsx");
  await vi.waitFor(() => expect(root.querySelector(".xlsx-grid")).not.toBeNull());
  return root;
}
const cellText = (root: HTMLElement) => [...root.querySelectorAll(".xlsx-grid tbody tr")].map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent));

test("files over 100 MiB and non-packages are refused before parsing", async () => {
  state.size = 101 * 1024 * 1024;
  await expect(viewer.mount(document.createElement("div"), "big.xlsx")).rejects.toThrow(/100 MiB/);
  state.size = -1; state.bytes = new TextEncoder().encode("not a zip at all, just some text bytes");
  await expect(viewer.mount(document.createElement("div"), "bad.xlsx")).rejects.toThrow(/손상/);
});

test("a sheet shows formatted values, styles, merges and headers; text is never markup", async () => {
  const root = await mount(await makeXlsx([{ name: "첫 시트", xml: `<sheetData>
    <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="C1"><v>3</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>제목</t></is></c></row>
  </sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells>` }], { styles: STYLES, shared: "<si><t>&lt;b&gt;x&lt;/b&gt;</t></si>" }));
  expect([...root.querySelectorAll(".xlsx-grid thead th")].map(th => th.textContent)).toEqual(["", "A", "B", "C"]);
  expect(cellText(root)).toEqual([["<b>x</b>", "3"], ["제목", "", ""]]);
  const merged = root.querySelector<HTMLTableCellElement>(".xlsx-grid tbody td")!;
  expect(merged.colSpan).toBe(2);
  expect(merged.querySelector("b")).toBeNull();
  expect(merged.style.fontWeight).toBe("bold");
  expect(merged.style.backgroundColor).toBeTruthy();
  const number = root.querySelectorAll<HTMLTableCellElement>(".xlsx-grid tbody tr")[0].querySelectorAll("td")[1];
  expect(number.style.textAlign).toBe("right");
  // Text spills over an empty neighbour; a number does not.
  expect(root.querySelectorAll(".xlsx-grid tbody tr")[1].querySelector("td")!.classList.contains("xlsx-spill")).toBe(true);
  expect(number.classList.contains("xlsx-spill")).toBe(false);
  expect(root.querySelector(".xlsx-tabs")!.hasAttribute("hidden")).toBe(true);
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용");
});

test("sheet tabs and Ctrl+PageDown switch sheets; hidden sheets are counted, not shown", async () => {
  const root = await mount(await makeXlsx([
    { name: "하나", xml: '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' },
    { name: "숨김", state: "hidden", xml: "<sheetData/>" },
    { name: "둘", xml: '<sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData>' },
  ]));
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".xlsx-tab")];
  expect(tabs.map(t => t.textContent)).toEqual(["하나", "둘"]);
  expect(tabs[0].getAttribute("aria-current")).toBe("page");
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용 · 숨긴 시트 1개");
  tabs[1].click();
  await vi.waitFor(() => expect(cellText(root)).toEqual([["2"]]));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", ctrlKey: true }));
  await vi.waitFor(() => expect(cellText(root)).toEqual([["1"]]));
  expect(tabs[0].getAttribute("aria-current")).toBe("page");
});

test("long sheets page by 200 rows and hidden rows and columns are skipped", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => `<row r="${i + 1}"${i === 1 ? ' hidden="1"' : ""}><c r="A${i + 1}"><v>${i + 1}</v></c><c r="C${i + 1}"><v>0</v></c></row>`).join("");
  const root = await mount(await makeXlsx([{ name: "긴 시트", xml: `<cols><col min="2" max="2" width="9" hidden="1"/></cols><sheetData>${rows}</sheetData>` }]));
  const body = () => [...root.querySelectorAll(".xlsx-grid tbody th")].map(th => th.textContent);
  expect(body()[0]).toBe("1"); expect(body()[1]).toBe("3"); expect(body()).toHaveLength(199);
  expect([...root.querySelectorAll(".xlsx-grid thead th")].map(th => th.textContent)).toEqual(["", "A", "C"]);
  const pages = root.querySelector<HTMLElement>(".data-pages")!;
  expect(pages.hidden).toBe(false);
  pages.querySelector<HTMLButtonElement>('[aria-label="다음 페이지"]')!.click();
  expect(body()[0]).toBe("201"); expect(body()).toHaveLength(50);
});

test("frozen rows and columns stick on the first page", async () => {
  const root = await mount(await makeXlsx([{ name: "고정", xml: `<sheetViews><sheetView><pane xSplit="1" ySplit="1" state="frozen"/></sheetView></sheetViews>
    <sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row></sheetData>` }]));
  const [first, second] = [...root.querySelectorAll<HTMLTableRowElement>(".xlsx-grid tbody tr")];
  expect(first.classList.contains("xlsx-frozen-row")).toBe(true);
  expect(first.querySelector("td")!.style.top).toBe("20px");
  expect(second.classList.contains("xlsx-frozen-row")).toBe(false);
  expect(second.querySelector("td")!.classList.contains("xlsx-frozen-col")).toBe(true);
  expect(second.querySelector("td")!.style.left).toBe("44px");
});
