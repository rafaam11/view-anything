// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { HIGHLIGHT_LIMIT, highlightHtml, languageFor, withinHighlightLimit } from "../src/text/highlight";

test("extensions map to highlight.js languages and plain text stays plain", () => {
  expect(languageFor("a/b.PY")).toBe("python");
  expect(languageFor("C:\\src\\x.tsx")).toBe("typescript");
  expect(languageFor("main.rs")).toBe("rust");
  expect(languageFor("build.cmd")).toBe("dos");
  expect(languageFor("page.htm")).toBe("xml");
  expect(languageFor("Cargo.toml")).toBe("ini");
  expect(languageFor("notes.txt")).toBeNull();
  expect(languageFor("run.log")).toBeNull();
  expect(languageFor("README")).toBeNull();
});

test("every mapped language loads and highlights", async () => {
  for (const path of ["a.c", "a.cpp", "a.py", "a.rs", "a.js", "a.ts", "a.sh", "a.ps1", "a.bat", "a.sql", "a.java", "a.cs", "a.go", "a.rb", "a.lua", "a.xml", "a.css", "a.scss", "a.ini"]) {
    const html = await highlightHtml("x = 1\n", languageFor(path)!);
    const host = document.createElement("pre"); host.innerHTML = html;
    expect(host.textContent, path).toBe("x = 1\n");
  }
});

test("highlighting escapes markup in the source", async () => {
  const source = '<script>alert(1)</script><img src=x onerror="alert(2)">';
  const host = document.createElement("pre"); host.innerHTML = await highlightHtml(source, "xml");
  expect(host.querySelector("script, img")).toBeNull();
  expect(host.textContent).toBe(source);
});

test("large files are not highlighted", () => {
  expect(withinHighlightLimit("a\n".repeat(10))).toBe(true);
  expect(withinHighlightLimit("x".repeat(HIGHLIGHT_LIMIT.chars + 1))).toBe(false);
  expect(withinHighlightLimit("\n".repeat(HIGHLIGHT_LIMIT.lines + 1))).toBe(false);
});
