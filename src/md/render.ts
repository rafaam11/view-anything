import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import type { Element, Root, RootContent } from "hast";
import { mdProcessor } from "./splice";

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface RenderOptions {
  baseDir: string;
  assetUrl: (abs: string) => string;
}

const SCHEME = /^[a-z][a-z0-9+.-]+:/i; // 2+ chars so "C:\x" is a path, not a scheme
const DRIVE = /^[A-Za-z]:/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Absolute local path for a relative/absolute file reference, or null for URLs and anchors. */
export function resolveAsset(baseDir: string, href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//") || SCHEME.test(href)) return null;
  const rel = safeDecode(href.replace(/[?#].*$/, ""));
  if (!rel) return null;
  if (DRIVE.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) return rel;

  const sep = baseDir.includes("\\") ? "\\" : "/";
  let prefix = "";
  let rest = baseDir;
  if (DRIVE.test(rest)) {
    prefix = rest.slice(0, 2);
    rest = rest.slice(2);
  }
  const lead = /^[\\/]/.test(rest) ? sep : "";
  const parts = rest.split(/[\\/]/).filter(Boolean);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return prefix + lead + parts.join(sep);
}

function textOf(node: RootContent | Root): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return (node.children as RootContent[]).map(textOf).join("");
  return "";
}

/** `pre > code.language-mermaid` becomes `div.mermaid` holding the source, rendered lazily later. */
function rehypeMermaid() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      node.children.forEach((child, i) => {
        if (child.type !== "element") return;
        const code = child.tagName === "pre" ? child.children[0] : undefined;
        const cls = code && code.type === "element" ? code.properties?.className : undefined;
        if (code && code.type === "element" && Array.isArray(cls) && cls.includes("language-mermaid")) {
          node.children[i] = {
            type: "element",
            tagName: "div",
            properties: { className: ["mermaid"] },
            children: [{ type: "text", value: textOf(code) }],
          };
        } else {
          walk(child);
        }
      });
    };
    walk(tree);
  };
}

function rehypeImages(opts: RenderOptions) {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "img" && typeof child.properties?.src === "string") {
          const abs = resolveAsset(opts.baseDir, child.properties.src);
          if (abs) child.properties.src = opts.assetUrl(abs);
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

function rehypeHeadings(out: Heading[]) {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const m = /^h([1-6])$/.exec(child.tagName);
        if (m && typeof child.properties?.id === "string") {
          out.push({ depth: Number(m[1]), id: child.properties.id, text: textOf(child) });
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

export async function renderMarkdown(src: string, opts: RenderOptions): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = [];
  // No rehype-raw and no allowDangerousHtml: raw HTML in markdown is dropped, never executed.
  const file = await mdProcessor()
    .use(remarkRehype, { handlers: { yaml: () => undefined } })
    .use(rehypeMermaid)
    .use(rehypeKatex)
    .use(rehypeHighlight, { detect: false })
    .use(rehypeSlug)
    .use(rehypeImages, opts)
    .use(rehypeHeadings, headings)
    .use(rehypeStringify)
    .process(src);
  return { html: String(file), headings };
}
