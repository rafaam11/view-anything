// Single-file HTML for an exported 3D scene: CSP meta, the GLB (base64), the state JSON and the
// runtime script, all inline. Nothing in it can close a <script> element early: the runtime has
// `</script` and `<!--` escaped, the JSON escapes < > & and the JS line separators, the GLB is
// base64. Part names only ever reach the page through the JSON (the runtime shows them with
// textContent).
import { toBase64 } from "./codec";
import type { ExportState } from "./state";

export const EXPORT_CSP = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:";

const BACKSLASH = String.fromCharCode(92);
/** U+2028 / U+2029: valid in JSON, line terminators in older JS parsers. */
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const JSON_UNSAFE = new RegExp(`[<>&${LINE_SEPARATORS}]`, "g");

/**
 * Make script text safe inside an inline <script>: `</script` (any case) and `<!--` cannot occur.
 * Both rewrites keep the JavaScript meaning: they can only appear in strings, template literals,
 * regular expressions or comments, where `<\/` and `<\!` read as `</` and `<!`.
 */
export function escapeScript(js: string): string {
  return js.replace(/<\/(script)/gi, `<${BACKSLASH}/$1`).replace(/<!--/g, `<${BACKSLASH}!--`);
}

/** JSON for a <script type="application/json"> body. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(JSON_UNSAFE, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface HtmlParts {
  title: string;
  glb: Uint8Array;
  state: ExportState;
  /** The va-runtime IIFE (build/runtime/va-runtime.js). */
  runtime: string;
}

export function renderHtml({ title, glb, state, runtime }: HtmlParts): string {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`,
    '<meta name="generator" content="view-anything">',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    '<div id="va-app"></div>',
    `<script type="application/octet-stream" id="va-glb">${toBase64(glb)}</script>`,
    `<script type="application/json" id="va-state">${jsonForScript(state)}</script>`,
    `<script>${escapeScript(runtime)}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Save dialog default: the first file's folder and name, with .html ("D:/m/a.step" -> "D:/m/a.html"). */
export function defaultHtmlPath(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return path.slice(0, path.length - name.length) + `${stem}.html`;
}
