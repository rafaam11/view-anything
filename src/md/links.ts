import { resolveAsset } from "./render";

export type LinkAction =
  | { kind: "anchor"; hash: string }
  | { kind: "external"; url: string }
  /** Another markdown file: open it in this window (after checking it exists). */
  | { kind: "markdown"; path: string; hash: string }
  /** Any other local file or folder: hand it to the OS default app (after checking it exists). */
  | { kind: "open"; path: string }
  /** A program or script: a document link must never launch it. */
  | { kind: "blocked"; path: string }
  | { kind: "ignore" };

const EXTERNAL = /^(https?:|mailto:)/i;
const MD_FILE = /\.(md|markdown)$/i;
/** Extensions the OS would execute (or follow to an executable) instead of opening as a document. */
const EXECUTABLE =
  /\.(exe|com|bat|cmd|msi|msp|msc|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|scr|pif|lnk|url|hta|cpl|reg|jar|appref-ms|application|gadget|inf|sh|bash|zsh|run|bin|appimage|desktop|command|app)$/i;

export function classifyLink(href: string, baseDir: string): LinkAction {
  if (!href) return { kind: "ignore" };
  if (href.startsWith("#")) return { kind: "anchor", hash: href };
  if (EXTERNAL.test(href)) return { kind: "external", url: href };
  const path = resolveAsset(baseDir, href);
  if (!path) return { kind: "ignore" };
  if (MD_FILE.test(path)) {
    const at = href.indexOf("#");
    return { kind: "markdown", path, hash: at >= 0 ? href.slice(at) : "" };
  }
  // Windows ignores trailing dots/spaces and the default ::$DATA stream when resolving a name.
  if (EXECUTABLE.test(path.replace(/(::\$DATA)?[.\s]*$/i, ""))) return { kind: "blocked", path };
  return { kind: "open", path };
}
