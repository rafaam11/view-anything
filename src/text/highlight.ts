/**
 * Syntax highlighting for the text viewer. highlight.js core and each language load only when a
 * code file is shown: an explicit loader table (not a template import) keeps the build from
 * emitting all 190 languages and keeps them out of the text viewer chunk.
 */
type Language = { default: import("highlight.js").LanguageFn };
const LOADERS: Record<string, () => Promise<Language>> = {
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  bash: () => import("highlight.js/lib/languages/bash"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  dos: () => import("highlight.js/lib/languages/dos"),
  sql: () => import("highlight.js/lib/languages/sql"),
  java: () => import("highlight.js/lib/languages/java"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  go: () => import("highlight.js/lib/languages/go"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  lua: () => import("highlight.js/lib/languages/lua"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  ini: () => import("highlight.js/lib/languages/ini"),
};
const BY_EXTENSION: Record<string, string> = {
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", py: "python", rs: "rust",
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", sh: "bash", bash: "bash",
  ps1: "powershell", bat: "dos", cmd: "dos", sql: "sql", java: "java", cs: "csharp", go: "go",
  rb: "ruby", lua: "lua", xml: "xml", html: "xml", htm: "xml", css: "css", scss: "scss",
  ini: "ini", cfg: "ini", conf: "ini", toml: "ini",
};
/** Beyond this the overlay would make typing and scrolling heavy; the text stays plain. */
export const HIGHLIGHT_LIMIT = { chars: 1_000_000, lines: 20_000 };

/** The highlight.js language for a file, or null for plain text (txt, log, unknown). */
export function languageFor(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

export function withinHighlightLimit(text: string): boolean {
  if (text.length > HIGHLIGHT_LIMIT.chars) return false;
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) if (++lines > HIGHLIGHT_LIMIT.lines) return false;
  return true;
}

let core: Promise<import("highlight.js").HLJSApi> | null = null;
const registered = new Set<string>();

/**
 * Escaped HTML of `text` with highlight.js class spans. highlight.js escapes every character of
 * the source, so the result only ever contains its own spans.
 */
export async function highlightHtml(text: string, language: string): Promise<string> {
  const loader = LOADERS[language];
  if (!loader) throw new Error(`지원하지 않는 언어: ${language}`);
  core ??= import("highlight.js/lib/core").then((m) => m.default);
  const hljs = await core;
  if (!registered.has(language)) {
    hljs.registerLanguage(language, (await loader()).default);
    registered.add(language);
  }
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}
