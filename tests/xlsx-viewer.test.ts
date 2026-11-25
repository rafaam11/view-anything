// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { makeXlsx, STYLES } from "./xlsx-fixture";

const state = vi.hoisted(() => ({ bytes: new Uint8Array(), size: -1, copied: [] as string[] }));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.size >= 0 ? state.size : state.bytes.length,
  readFileRaw: async () => state.bytes.slice().buffer,
  setWindowTitle: async () => {},
  copyText: async (text: string) => { state.copied.push(text); },
  alert: async () => {},
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
  // As in Excel the tab of a one-sheet workbook still shows.
  expect([...root.querySelectorAll(".xlsx-tab")].map(t => t.textContent)).toEqual(["첫 시트"]);
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

const td = (root: HTMLElement, r: number, c: number) => root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)!;
const press = (key: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
const down = (el: Element, init: PointerEventInit = {}) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...init }));

const BOOK = () => makeXlsx([{ name: "계산", xml: `<sheetData>
  <row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1" t="inlineStr"><is><t>글자</t></is></c></row>
  <row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" ref="B2:B3" si="0">A2*2</f><v>6</v></c></row>
  <row r="3"><c r="A3"><v>5</v></c><c r="B3"><f t="shared" si="0"/><v>10</v></c></row>
  <row r="5"><c r="A5"><v>9</v></c></row>
</sheetData>` }]);

test("the name box and formula bar follow the active cell, shared formulas shifted", async () => {
  const root = await mount(await BOOK());
  const name = root.querySelector(".xlsx-name-box")!, formula = root.querySelector(".xlsx-formula")!;
  expect(name.textContent).toBe("A1"); expect(formula.textContent).toBe("1");
  expect(td(root, 0, 0).classList.contains("xlsx-active")).toBe(true);
  down(td(root, 2, 1));
  window.dispatchEvent(new PointerEvent("pointerup"));
  expect(name.textContent).toBe("B3"); expect(formula.textContent).toBe("=A3*2");
  down(td(root, 1, 1));
  expect(formula.textContent).toBe("=A2*2");
  expect(root.querySelector("thead th[data-c='1']")!.classList.contains("xlsx-sel-head")).toBe(true);
});

test("arrows, Shift and Ctrl move and extend like Excel; the status bar sums the selection", async () => {
  const root = await mount(await BOOK());
  const scroll = root.querySelector<HTMLElement>(".xlsx-scroll")!;
  const key = (k: string, init: KeyboardEventInit = {}) => scroll.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  const name = root.querySelector(".xlsx-name-box")!;
  key("ArrowDown"); key("ArrowRight");
  expect(name.textContent).toBe("B2");
  key("ArrowUp", { shiftKey: true }); key("ArrowLeft", { shiftKey: true });
  expect(name.textContent).toBe("B2"); // Shift extends from the active cell, which stays
  expect(td(root, 1, 1).classList.contains("xlsx-sel")).toBe(true);
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용   평균: 3   개수: 4   합계: 12");
  key("Home", { ctrlKey: true });
  key("ArrowDown", { ctrlKey: true }); // A1..A3 is one block: to its end
  expect(name.textContent).toBe("A3");
  key("ArrowDown", { ctrlKey: true }); // then to the next filled cell
  expect(name.textContent).toBe("A5");
  key("Home", { ctrlKey: true });
  expect(name.textContent).toBe("A1");
  key("Tab"); key("Tab");
  expect(name.textContent).toBe("C1");
  key("a", { ctrlKey: true });
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용   평균: 5.1428571429   개수: 8   합계: 36");
  key("c", { ctrlKey: true });
  const tsv = [["1", "2", "글자"], ["3", "6", ""], ["5", "10", ""], ["", "", ""], ["9", "", ""]].map(row => row.join("\t"));
  await vi.waitFor(() => expect(state.copied.at(-1)).toBe(`${tsv.join("\r\n")}\r\n`));
});

test("header clicks select whole columns and rows; cell keys leave the toolbar alone", async () => {
  const root = await mount(await BOOK());
  down(root.querySelector("thead th[data-c='1']")!);
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용   평균: 6   개수: 3   합계: 18");
  down(root.querySelector("tbody th[data-r='0']")!);
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용   평균: 1.5   개수: 3   합계: 3");
  const name = root.querySelector(".xlsx-name-box")!;
  const before = name.textContent;
  const button = root.querySelector<HTMLButtonElement>(".xlsx-tab")!;
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  expect(name.textContent).toBe(before);
  void press;
});
