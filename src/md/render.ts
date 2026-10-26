import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
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

/**
 * `\\server\share` (lowercased) of a UNC path, "local" for a non-UNC or `\\?\C:\` path, or null
 * for a path that must never be touched (device namespace, `..` in a UNC path).
 */
function uncRoot(path: string): string | null | "local" {
  let p = path.replace(/\//g, "\\");
  if (!p.startsWith("\\\\")) return "local";
  if (/^\\\\[?.]\\[A-Za-z]:\\/.test(p)) return "local";
  const unc = /^\\\\[?.]\\UNC\\/i.exec(p);
  if (unc) p = "\\\\" + p.slice(unc[0].length);
  else if (/^\\\\[?.]\\/.test(p)) return null; // \\.\pipe, \\?\GLOBALROOT, ...
  const segs = p.slice(2).split("\\");
  if (segs.length < 2 || !segs[0] || !segs[1] || segs.some((s) => s === "." || s === "..")) return null;
  return ("\\\\" + segs[0] + "\\" + segs[1]).toLowerCase();
}

/**
 * Absolute local path for a relative/absolute file reference, or null for URLs and anchors.
 * A UNC path is only returned when it lies on the same `\\server\share` as the document itself:
 * merely touching a foreign share (asset load, existence check) would open an SMB connection and
 * leak the user's NTLM credentials to whoever wrote the document.
 */
export function resolveAsset(baseDir: string, href: string): string | null {
  const path = resolvePath(baseDir, href);
  if (path === null) return null;
  const root = uncRoot(path);
  if (root === "local") return path;
  if (root === null) return null;
  const baseRoot = uncRoot(baseDir);
  return baseRoot !== null && baseRoot !== "local" && baseRoot === root ? path : null;
}

function resolvePath(baseDir: string, href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//") || SCHEME.test(href)) return null;
  const rel = safeDecode(href.replace(/[?#].*$/, ""));
  if (!rel) return null;
  if (DRIVE.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) return rel;

  const sep = baseDir.includes("\\") || DRIVE.test(baseDir) ? "\\" : "/";
  let prefix = "";
  let rest = baseDir;
  let floor = 0; // segments that ".." must not remove (UNC server and share)
  if (/^[\\/]{2}[^\\/]/.test(rest)) {
    prefix = sep + sep;
    rest = rest.slice(2);
    floor = 2;
  } else if (DRIVE.test(rest)) {
    prefix = rest.slice(0, 2);
    rest = rest.slice(2);
  }
  const lead = floor ? "" : sep;
  const parts = rest.split(/[\\/]/).filter(Boolean);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > floor) parts.pop();
    } else parts.push(seg);
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

/** Single-letter "schemes" are Windows drive letters (`C:\x.png`), i.e. local paths. */
const DRIVE_LETTERS = [..."abcdefghijklmnopqrstuvwxyz"].flatMap((c) => [c, c.toUpperCase()]);

/**
 * GitHub-like allow-list (hast-util-sanitize's defaultSchema) for raw HTML in markdown, extended
 * only where this app needs it. No `style`, no `on*`, no `class` on raw HTML; scripts, iframes,
 * objects, embeds, styles and forms are dropped. Unknown URL schemes (javascript:, vbscript:,
 * file:, ...) are removed from href/src.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  // <source srcset> would bypass the image path rewriting and the UNC check; <picture> keeps its <img>.
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== "source"),
  // Drop these with their content (a stripped <style> would otherwise leave its CSS as text).
  strip: [...(defaultSchema.strip ?? []), "style", "textarea", "select", "noscript", "template"],
  attributes: {
    ...defaultSchema.attributes,
    // remark-math marks math as `code.language-math.math-inline|math-display` for rehype-katex.
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), ...DRIVE_LETTERS],
    // `data:` is narrowed to data:image/* in rehypeImages.
    src: [...(defaultSchema.protocols?.src ?? []), "data", ...DRIVE_LETTERS],
  },
};

/**
 * The sanitizer must allow `input` for GFM task-list checkboxes, but raw HTML must not add form
 * controls. Before rehype-raw parses the raw HTML, the task-list inputs are the only `input`
 * elements; mark them, drop every unmarked input after parsing. The marker attribute is not in
 * the schema, so sanitize removes it.
 */
const TASK_MARK = "dataVaTaskItem";
function rehypeMarkTaskInputs() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "input") child.properties[TASK_MARK] = true;
        walk(child);
      }
    };
    walk(tree);
  };
}
function rehypeDropRawInputs() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      node.children = node.children.filter(
        (c) => !(c.type === "element" && c.tagName === "input" && c.properties?.[TASK_MARK] === undefined),
      ) as typeof node.children;
      for (const child of node.children) if (child.type === "element") walk(child);
    };
    walk(tree);
  };
}

/** Runs after sanitize: rewrites local image paths to asset URLs (last, so nothing strips them). */
function rehypeImages(opts: RenderOptions) {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "img" && typeof child.properties?.src === "string") {
          const src = child.properties.src;
          const abs = resolveAsset(opts.baseDir, src);
          if (abs) child.properties.src = opts.assetUrl(abs);
          // Anything else that is not a web or inline image (a refused UNC path, `/\host\...`
          // which the webview would read as `//host/...`) is dropped rather than left to the webview.
          else if (!/^(https?:\/\/|data:image\/)/i.test(src)) delete child.properties.src;
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
  // Raw HTML is parsed (rehype-raw) and then reduced to a safe allow-list (rehype-sanitize)
  // before anything this app generates (ids, KaTeX, highlight, mermaid, asset URLs) is added.
  // Sanitize prefixes every id/name with "user-content-" (DOM clobbering), so remark-rehype adds
  // none itself; `#fn-1` style anchors are resolved against the prefixed id by the viewer.
  const file = await mdProcessor()
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "", handlers: { yaml: () => undefined } })
    .use(rehypeMarkTaskInputs)
    .use(rehypeRaw)
    .use(rehypeDropRawInputs)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeMermaid)
    .use(rehypeSlug)
    .use(rehypeHeadings, headings)
    .use(rehypeKatex)
    .use(rehypeHighlight, { detect: false })
    .use(rehypeImages, opts)
    .use(rehypeStringify)
    .process(src);
  return { html: String(file), headings };
}
