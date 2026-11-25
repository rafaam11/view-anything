import JSZip from "jszip";
import { all, children, first, officeDocumentPath, relationships, xml } from "./ooxml";

/**
 * Paragraph styles that are headings, with their level (1-9): built-in "heading N" styles (their
 * style names stay English in every language) and styles with an outline level, followed through
 * `basedOn`. This is what Word's navigation pane lists.
 */
export async function headingStyles(bytes: Uint8Array): Promise<Map<string, number>> {
  const zip = await JSZip.loadAsync(bytes);
  const documentPath = await officeDocumentPath(zip);
  const rels = await relationships(zip, documentPath);
  const stylesPath = [...rels.values()].find(r => /\/styles$/.test(r.type))?.path;
  const doc = stylesPath ? await xml(zip, stylesPath) : null;
  const out = new Map<string, number>();
  if (!doc) return out;
  const styles = new Map<string, { level?: number; basedOn?: string }>();
  for (const style of all(doc, "style")) {
    if (attr(style, "type") !== "paragraph") continue;
    const id = attr(style, "styleId");
    if (!id) continue;
    const name = attr(first(style, "name"), "val") ?? "";
    const heading = /^heading ([1-9])$/i.exec(name.trim());
    const pPr = children(style, "pPr")[0];
    const outline = pPr ? attr(children(pPr, "outlineLvl")[0], "val") : undefined;
    const level = heading ? Number(heading[1]) : outline !== undefined && /^[0-8]$/.test(outline) ? Number(outline) + 1 : undefined;
    styles.set(id, { level, basedOn: attr(first(style, "basedOn"), "val") });
  }
  const resolve = (id: string, seen = new Set<string>()): number | undefined => {
    const style = styles.get(id);
    if (!style || seen.has(id)) return undefined;
    seen.add(id);
    return style.level ?? (style.basedOn ? resolve(style.basedOn, seen) : undefined);
  };
  for (const id of styles.keys()) { const level = resolve(id); if (level) out.set(id, level); }
  return out;
}

/** The class docx-preview gives paragraphs of a style (its `processStyleName`). */
export function styleClass(styleId: string, prefix = "docx"): string {
  return `${prefix}_${styleId.replace(/[ .]+/g, "-").replace(/[&]+/g, "and").toLowerCase()}`;
}

/** `w:val`-style attributes, whatever prefix the writer used. */
function attr(node: Element | null | undefined, name: string): string | undefined {
  if (!node) return undefined;
  return [...node.attributes].find(a => a.localName === name || a.name.endsWith(`:${name}`))?.value;
}
