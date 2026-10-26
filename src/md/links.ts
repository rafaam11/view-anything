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
/**
 * Extensions the OS would execute, install, import or follow to an executable instead of opening
 * as a document. Mirrored as a deny scope of `opener:allow-open-path` in
 * src-tauri/capabilities/default.json (a test keeps both in sync).
 */
export const EXECUTABLE_EXTENSIONS = [
  // Windows programs, installers and shell-executed types
  "exe", "com", "bat", "cmd", "msi", "msp", "msc", "scr", "pif", "cpl", "hta", "inf", "reg", "chm",
  "lnk", "url", "scf", "library-ms", "settingcontent-ms", "searchconnector-ms", "website", "appref-ms",
  "application", "gadget", "xbap", "diagcab",
  // Disk images (mounting one exposes its autorun/executables)
  "iso", "img", "vhd", "vhdx",
  "appx", "appxbundle", "msix", "msixbundle", "appinstaller",
  // Script hosts
  "ps1", "psm1", "psd1", "ps1xml", "ps2", "psc1", "msh", "msh1", "msh2", "msh1xml", "msh2xml",
  "vb", "vbs", "vbe", "js", "jse", "ws", "wsf", "wsh", "wsc", "sct",
  "py", "pyw", "jar",
  // Unix
  "sh", "bash", "zsh", "run", "bin", "appimage", "desktop", "command", "app",
];
const EXECUTABLE = new RegExp("\\.(" + EXECUTABLE_EXTENSIONS.join("|") + ")$", "i");

/**
 * The name Windows actually resolves: an alternate data stream suffix (`:zone`, `::$DATA`) is cut
 * and trailing dots/spaces are ignored, so `a.exe::$DATA` and `a.exe. ` are `a.exe`.
 */
function effectiveName(path: string): string {
  let name = path.split(/[\\/]/).pop() ?? path;
  const colon = name.indexOf(":");
  if (colon > 0) name = name.slice(0, colon);
  return name.replace(/[.\s]+$/, "");
}

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
  if (EXECUTABLE.test(effectiveName(path))) return { kind: "blocked", path };
  return { kind: "open", path };
}
