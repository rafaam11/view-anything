// @vitest-environment happy-dom
import JSZip from "jszip";
import { expect, test } from "vitest";
import { renderAsync } from "docx-preview";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The real renderer with the viewer's options on a minimal document: text, bold, a table, a link. */
test("docx-preview renders a minimal document with the viewer's options", async () => {
  const z = new JSZip();
  z.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rL" Type="${REL}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`);
  z.file("word/document.xml", `<w:document ${W}><w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>굵은 제목</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rL"><w:r><w:t>링크</w:t></w:r></w:hyperlink></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body></w:document>`);
  const body = document.createElement("div"), styles = document.createElement("div");
  document.body.append(body, styles);
  await renderAsync(await z.generateAsync({ type: "uint8array" }), body, styles, {
    className: "docx", inWrapper: true, useBase64URL: true, renderAltChunks: false, experimental: false,
  });
  const page = body.querySelector("section.docx")!;
  expect(page).not.toBeNull();
  expect(page.textContent).toContain("굵은 제목");
  expect(page.querySelectorAll("td")).toHaveLength(2);
  // happy-dom drops XML namespaces, so the relationship target is checked in the real app only.
  expect(page.querySelector("a")!.textContent).toBe("링크");
  expect(page.querySelector("script, iframe")).toBeNull();
});
