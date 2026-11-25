import JSZip from "jszip";
import { all, children, first, officeDocumentPath, relationshipId, relationships, xml } from "./ooxml";

/**
 * Speaker notes per slide, in presentation order (the order of `p:sldIdLst`, as the renderer
 * shows them). A slide without a notes page, or with an empty one, gets "". The notes text is the
 * body placeholder of the notes page: one line per paragraph, runs joined.
 */
export async function readNotes(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const presentationPath = await officeDocumentPath(zip);
  const presentation = await xml(zip, presentationPath);
  if (!presentation) return [];
  const rels = await relationships(zip, presentationPath);
  const notes: string[] = [];
  for (const sld of all(presentation, "sldId")) {
    const id = relationshipId(sld);
    const slide = id ? rels.get(id) : undefined;
    if (!slide) { notes.push(""); continue; }
    const slideRels = await relationships(zip, slide.path);
    const notesPart = [...slideRels.values()].find(r => /\/notesSlide$/.test(r.type));
    const doc = notesPart ? await xml(zip, notesPart.path) : null;
    notes.push(doc ? notesText(doc) : "");
  }
  return notes;
}

function notesText(doc: Document): string {
  for (const shape of all(doc, "sp")) {
    const placeholder = first(shape, "ph");
    if (placeholder?.getAttribute("type") !== "body") continue;
    const body = first(shape, "txBody");
    if (!body) return "";
    return children(body, "p").map(p => all(p, "t").map(t => t.textContent ?? "").join("")).join("\n").trim();
  }
  return "";
}
