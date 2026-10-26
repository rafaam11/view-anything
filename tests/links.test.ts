import { expect, test } from "vitest";
import { classifyLink } from "../src/md/links";

const base = "D:\\docs";

test("anchors and external urls", () => {
  expect(classifyLink("#intro", base)).toEqual({ kind: "anchor", hash: "#intro" });
  expect(classifyLink("https://x.dev/a", base)).toEqual({ kind: "external", url: "https://x.dev/a" });
  expect(classifyLink("mailto:a@b.c", base)).toEqual({ kind: "external", url: "mailto:a@b.c" });
});

test("markdown links navigate with their hash", () => {
  expect(classifyLink("sub/a.md#sec", base)).toEqual({ kind: "markdown", path: "D:\\docs\\sub\\a.md", hash: "#sec" });
  expect(classifyLink("../README.MARKDOWN", base)).toEqual({ kind: "markdown", path: "D:\\README.MARKDOWN", hash: "" });
});

test("other local files and folders open with the OS default app", () => {
  expect(classifyLink("src/main.cpp", base)).toEqual({ kind: "open", path: "D:\\docs\\src\\main.cpp" });
  expect(classifyLink("img/a.png", base)).toEqual({ kind: "open", path: "D:\\docs\\img\\a.png" });
  expect(classifyLink("sub/", base)).toEqual({ kind: "open", path: "D:\\docs\\sub" });
});

test("root-relative links resolve to the raw path (existence is checked by the caller)", () => {
  expect(classifyLink("/docs/x.md", base)).toEqual({ kind: "markdown", path: "/docs/x.md", hash: "" });
});

test("executables and shell scripts are never launched from a document", () => {
  for (const f of ["a.exe", "b.BAT", "c.cmd", "d.ps1", "e.vbs", "f.js", "g.lnk", "h.msi", "i.sh", "j.scr", "k.hta", "l.exe.", "m.exe%20", "o.exe..%20"]) {
    expect(classifyLink(f, base).kind).toBe("blocked");
  }
  // "name.ext:" parses as a URL scheme and is not followed at all.
  expect(classifyLink("n.exe::$DATA", base).kind).toBe("ignore");
});

test("scripts, installers and shell-handled types are blocked too, in any case", () => {
  const exts = [
    "py", "pyw", "chm", "appx", "appxbundle", "msix", "msixbundle", "appinstaller", "settingcontent-ms",
    "scf", "library-ms", "ws", "wsh", "vb", "ps1xml", "ps2", "psc1", "msh", "application", "gadget",
    "cpl", "hta", "jar", "reg", "lnk", "url",
  ];
  for (const ext of exts) {
    expect(classifyLink("a." + ext, base).kind, ext).toBe("blocked");
    expect(classifyLink("a." + ext.toUpperCase(), base).kind, ext).toBe("blocked");
  }
});

test("trailing dots, spaces and alternate data streams resolve to the real extension", () => {
  for (const f of ["s/a.py.", "s/a.py%20", "s/a.exe::$DATA", "s/a.EXE::$data", "s/a.exe:zone", "s/a.exe:zone:$DATA", "s/a.reg. .", "s/a.msix::$DATA."]) {
    expect(classifyLink(f, base).kind, f).toBe("blocked");
  }
  // a stream of a document stays a document
  expect(classifyLink("s/a.txt:zone", base).kind).toBe("open");
});

test("links to foreign unc shares are ignored (no SMB on click)", () => {
  for (const f of ["\\\\evil\\share\\doc.txt", "/\\evil\\share\\doc.txt", "\\/evil/share/doc.md", "%5C%5Cevil%5Cs%5Cd.txt"]) {
    expect(classifyLink(f, base), f).toEqual({ kind: "ignore" });
  }
  const unc = "\\\\srv\\share\\d";
  // device-namespace paths are refused wherever the document lives
  for (const f of [
    "\\/.\\C:\\..\\UNC\\evil\\share\\x.png",
    "\\/?\\C:\\..\\UNC\\evil\\s\\x",
    "\\\\.\\C:\\..\\GLOBALROOT\\Device\\Mup\\evil\\s\\x.txt",
    "\\\\.\\C:\\..\\pipe\\x",
    "%5C%5C.%5CC:%5C..%5CUNC%5Cevil%5Cshare%5Cx.txt",
    "%5C/.%5CC:%5C..%5Cpipe%5Cx",
    "\\\\.\\c:\\docs\\a.md",
  ]) {
    expect(classifyLink(f, base), f).toEqual({ kind: "ignore" });
    expect(classifyLink(f, unc), f).toEqual({ kind: "ignore" });
  }
  expect(classifyLink("x.txt", unc)).toEqual({ kind: "open", path: "\\\\srv\\share\\d\\x.txt" });
  expect(classifyLink("\\\\evil\\share\\doc.txt", unc)).toEqual({ kind: "ignore" });
});

test("more script hosts and mountable images are blocked", () => {
  for (const ext of ["wsc", "sct", "xbap", "diagcab", "searchConnector-ms", "website", "msh1", "msh2", "msh1xml", "msh2xml", "iso", "img", "vhd", "vhdx"]) {
    expect(classifyLink("a." + ext, base).kind, ext).toBe("blocked");
    expect(classifyLink("a." + ext.toUpperCase(), base).kind, ext).toBe("blocked");
  }
});

test("unsupported schemes are ignored", () => {
  expect(classifyLink("file:///C:/x.txt", base)).toEqual({ kind: "ignore" });
  expect(classifyLink("javascript:alert(1)", base)).toEqual({ kind: "ignore" });
  expect(classifyLink("", base)).toEqual({ kind: "ignore" });
});
