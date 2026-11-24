import JSZip from "jszip";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal xlsx package: one worksheet part per entry, optional shared strings and styles. */
export async function makeXlsx(sheets: { name: string; xml: string; state?: string }[], extra: { shared?: string; styles?: string; date1904?: boolean } = {}) {
  const z = new JSZip();
  z.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file("xl/workbook.xml", `<workbook ${NS}>${extra.date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.state ? ` state="${s.state}"` : ""}/>`).join("")}</sheets></workbook>`);
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  if (extra.shared) rels.push(`<Relationship Id="rS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
  if (extra.styles) rels.push(`<Relationship Id="rT" Type="${REL}/styles" Target="/xl/styles.xml"/>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}>${s.xml}</worksheet>`));
  if (extra.shared) z.file("xl/sharedStrings.xml", `<sst ${NS}>${extra.shared}</sst>`);
  if (extra.styles) z.file("xl/styles.xml", `<styleSheet ${NS}>${extra.styles}</styleSheet>`);
  return z.generateAsync({ type: "uint8array" });
}

export const STYLES = `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; m&quot;월&quot; d&quot;일&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="14"/><color rgb="FFFF0000"/><name val="맑은 고딕"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FF0000FF"/></left><bottom style="double"/></border></borders>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="10" fontId="1" fillId="2" borderId="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0"><alignment horizontal="center" vertical="center" wrapText="1" indent="2"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0"/></cellXfs>`;
