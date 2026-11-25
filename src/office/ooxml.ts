import type JSZip from "jszip";

/** Small helpers for reading Office Open XML packages (shared by the xlsx and pptx readers). */
export type Rels = Map<string, { type: string; path: string }>;

export async function officeDocumentPath(zip: JSZip): Promise<string> {
  const root = await relationships(zip, "");
  return [...root.values()].find(r => /\/officeDocument$/.test(r.type))?.path ?? "xl/workbook.xml";
}

export async function relationships(zip: JSZip, part: string): Promise<Rels> {
  const dir = part.includes("/") ? part.slice(0, part.lastIndexOf("/") + 1) : "";
  const file = part ? `${dir}_rels/${part.slice(dir.length)}.rels` : "_rels/.rels";
  const doc = await xml(zip, file);
  const out: Rels = new Map();
  if (!doc) return out;
  for (const r of all(doc, "Relationship")) {
    const id = r.getAttribute("Id"), target = r.getAttribute("Target"), type = r.getAttribute("Type") ?? "";
    if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
    out.set(id, { type, path: resolvePath(dir, target) });
  }
  return out;
}

export function resolvePath(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}

export async function xml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))[0];
  if (!file) return null;
  const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(`XML을 읽을 수 없습니다: ${path}`);
  return doc;
}

/** Element name without its prefix (`x:row` → `row`); DOM implementations differ on namespaces. */
export function local(e: Element): string {
  const name = e.localName;
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
/** Descendants named `name`, in document order; stops at the first match when `one`. */
export function walk(node: Document | Element, name: string, one: boolean): Element[] {
  const out: Element[] = [];
  const start = "documentElement" in node ? node.documentElement : node;
  if (!start) return out;
  const stack: Element[] = "documentElement" in node ? [start] : [...start.children].reverse();
  while (stack.length) {
    const e = stack.pop() as Element;
    if (local(e) === name) { out.push(e); if (one) break; }
    for (let i = e.children.length - 1; i >= 0; i--) stack.push(e.children[i]);
  }
  return out;
}
export function all(node: Document | Element, name: string): Element[] {
  return walk(node, name, false);
}
export function first(node: Document | Element, name: string): Element | null {
  return walk(node, name, true)[0] ?? null;
}
export function children(node: Element, name: string): Element[] {
  return [...node.children].filter(c => local(c) === name);
}
export function num(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
export function truthy(value: string | null): boolean {
  return value === "1" || value === "true";
}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_REL_NS = "http://purl.oclc.org/ooxml/officeDocument/relationships";

/** The `r:id` (or `r:embed`…) attribute of an element, whatever prefix the writer used. */
export function relationshipId(node: Element, name = "id"): string | undefined {
  return [...node.attributes].find(a => a.namespaceURI === REL_NS || a.namespaceURI === STRICT_REL_NS ? a.localName === name : new RegExp(`^[^:]+:${name}$`).test(a.name))?.value;
}
