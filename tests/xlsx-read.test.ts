// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { applyTint, columnName, parseRef, readWorkbook } from "../src/office/xlsx/read";
import { makeXlsx, STYLES } from "./xlsx-fixture";

test("cell references and column names round-trip", () => {
  expect(parseRef("A1")).toEqual({ row: 0, column: 0 });
  expect(parseRef("$AB$12")).toEqual({ row: 11, column: 27 });
  expect(parseRef("XFD1048576")).toEqual({ row: 1048575, column: 16383 });
  expect(parseRef("1A")).toBeNull();
  for (const c of [0, 25, 26, 701, 702, 16383]) expect(parseRef(`${columnName(c)}1`)?.column).toBe(c);
});

test("tint lightens and darkens like Excel", () => {
  expect(applyTint("#000000", 0.5)).toBe("#808080");
  expect(applyTint("#ffffff", -0.5)).toBe("#808080");
  expect(applyTint("#4472c4", 0)).toBe("#4472c4");
});

test("values are shown as Excel formats them", async () => {
  const bytes = await makeXlsx([{ name: "데이터", xml: `<sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>인라인</t></is></c></row>
    <row r="2"><c r="A2" s="1"><v>0.256</v></c><c r="B2" s="2"><v>45658</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#DIV/0!</v></c></row>
    <row r="3"><c r="A3" s="4"><f>SUM(1,2)</f><v>1234.5</v></c><c r="B3" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="C3"><v>12</v></c><c s="3"><v>1</v></c><c r="E3"><f>SUM(A1)</f><v></v></c></row>
  </sheetData>` }], {
    styles: STYLES,
    shared: `<si><t>&lt;script&gt;alert(1)&lt;/script&gt;</t></si><si><r><t>굵</t></r><r><t xml:space="preserve">게 </t></r><rPh><t>ふりがな</t></rPh></si>`,
  });
  const book = await readWorkbook(bytes);
  expect(book.sheets.map(s => s.name)).toEqual(["데이터"]);
  const sheet = await book.sheets[0].load();
  const text = (r: number, c: number) => sheet.rows.get(r)?.get(c)?.text;
  expect(text(0, 0)).toBe("<script>alert(1)</script>");
  expect(text(0, 1)).toBe("굵게 ");
  expect(text(0, 2)).toBe("인라인");
  expect(text(1, 0)).toBe("25.60%");
  expect(text(1, 1)).toBe("2025년 1월 1일");
  expect(text(1, 2)).toBe("TRUE");
  expect(text(1, 3)).toBe("#DIV/0!");
  expect(text(2, 0)).toBe("1,234.50");
  expect(text(2, 1)).toBe("ab");
  expect(text(2, 2)).toBe("12");
  expect(sheet.rows.get(2)?.get(2)?.number).toBe(true);
  expect(text(2, 3)).toBe("1/1/00"); // no `r`: the next column; serial 1 is 1900-01-01
  expect(sheet.rows.get(2)?.has(4)).toBe(false);
  expect(sheet.rowCount).toBe(3); expect(sheet.columnCount).toBe(4);
  const style = book.styles[1];
  expect(style).toMatchObject({ bold: true, italic: true, size: 14, color: "#ff0000", font: "맑은 고딕", fill: "#ffff00" });
  expect(style.left).toEqual({ style: "thin", color: "#0000ff" });
  expect(style.bottom).toEqual({ style: "double", color: null });
  expect(book.styles[3]).toMatchObject({ horizontal: "center", vertical: "center", wrap: true, indent: 2 });
});

test("1904 dates, hidden sheets, layout and merges", async () => {
  const bytes = await makeXlsx([
    { name: "숨김", state: "hidden", xml: "<sheetData/>" },
    { name: "배치", xml: `<sheetViews><sheetView showGridLines="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" state="frozen"/></sheetView></sheetViews>
      <sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="2" width="20.7109375" customWidth="1"/><col min="3" max="3" width="5" hidden="1"/></cols>
      <sheetData><row r="1" ht="30" customHeight="1"><c r="A1" s="2"><v>0</v></c></row><row r="4" hidden="1"><c r="B4"><v>1</v></c></row></sheetData>
      <mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>` },
  ], { styles: STYLES, date1904: true });
  const book = await readWorkbook(bytes);
  expect(book.hiddenSheets).toBe(1);
  expect(book.sheets.map(s => s.name)).toEqual(["배치"]);
  const sheet = await book.sheets[0].load();
  expect(sheet.rows.get(0)?.get(0)?.text).toBe("1904년 1월 1일");
  expect(sheet.gridLines).toBe(false);
  expect([sheet.frozenRows, sheet.frozenColumns]).toEqual([2, 1]);
  expect(sheet.columnWidths.get(0)).toBe(145); expect(sheet.columnWidths.get(1)).toBe(145);
  expect(sheet.hiddenColumns.has(2)).toBe(true);
  expect(sheet.rowHeights.get(0)).toBe(40);
  expect(sheet.defaultRowHeight).toBe(24);
  expect(sheet.defaultColumnWidth).toBe(64);
  expect(sheet.hiddenRows.has(3)).toBe(true);
  expect(sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
});

test("cells past the limit are dropped and reported", async () => {
  const row = (r: number) => `<row r="${r}">${[0, 1, 2].map(c => `<c><v>${c}</v></c>`).join("")}</row>`;
  const bytes = await makeXlsx([{ name: "큰 시트", xml: `<sheetData>${[1, 2, 3, 4].map(row).join("")}</sheetData>` }]);
  const sheet = await (await readWorkbook(bytes, 7)).sheets[0].load();
  expect(sheet.truncated).toBe(true);
  expect([...sheet.rows.values()].reduce((n, r) => n + r.size, 0)).toBe(7);
});

test("a package without worksheets is refused", async () => {
  const bytes = await makeXlsx([{ name: "x", state: "veryHidden", xml: "<sheetData/>" }]);
  await expect(readWorkbook(bytes)).rejects.toThrow(/워크시트/);
});
