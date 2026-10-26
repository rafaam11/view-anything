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

test("unsupported schemes are ignored", () => {
  expect(classifyLink("file:///C:/x.txt", base)).toEqual({ kind: "ignore" });
  expect(classifyLink("javascript:alert(1)", base)).toEqual({ kind: "ignore" });
  expect(classifyLink("", base)).toEqual({ kind: "ignore" });
});
