import { expect, test } from "vitest";
import { renderMarkdown, resolveAsset } from "../src/md/render";

const o = { baseDir: "D:\\d", assetUrl: (a: string) => "asset://" + a };

test("gfm table, math and code highlight render", async () => {
  const { html } = await renderMarkdown("|a|\n|-|\n|1|\n\n$x^2$\n\n```ts\nlet a=1\n```", o);
  expect(html).toContain("<table");
  expect(html).toContain("katex");
  expect(html).toContain("hljs");
});
test("mermaid block stays as placeholder for lazy render", async () => {
  expect((await renderMarkdown("```mermaid\ngraph TD;A-->B\n```", o)).html).toContain('class="mermaid"');
});
test("headings collected with slug ids", async () => {
  expect((await renderMarkdown("# 개요\n## A b", o)).headings).toEqual([
    { depth: 1, id: "개요", text: "개요" },
    { depth: 2, id: "a-b", text: "A b" },
  ]);
});
test("relative image with korean and space resolves via assetUrl", async () => {
  const { html } = await renderMarkdown("![x](./그림%201.png)", { baseDir: "D:\\문서", assetUrl: (a) => "asset://" + a });
  expect(html).toContain("asset://D:\\문서\\그림 1.png");
});
test("resolveAsset ignores urls and anchors", () => {
  expect(resolveAsset("D:\\d", "https://a.b/c.png")).toBeNull();
  expect(resolveAsset("D:\\d", "#top")).toBeNull();
});
test("resolveAsset handles parent dirs, absolute and posix bases", () => {
  expect(resolveAsset("D:\\a\\b", "../c.png")).toBe("D:\\a\\c.png");
  expect(resolveAsset("/home/u", "x/y.png")).toBe("/home/u/x/y.png");
  expect(resolveAsset("D:\\a", "C:\\z\\q.png")).toBe("C:\\z\\q.png");
  expect(resolveAsset("D:\\a", "n.md#sec")).toBe("D:\\a\\n.md");
});
test("raw html is not executed", async () => {
  expect((await renderMarkdown("<script>x</script><img src=x onerror=y>", o)).html).not.toMatch(/<script|onerror/);
});
test("unknown fence languages render as plain code", async () => {
  const src = "```zenoh\nx\n```\n\n```cmake\nset(A 1)\n```\n\n```powershell\nGet-Item\n```";
  const { html } = await renderMarkdown(src, o);
  expect(html).toContain("set(A 1)");
  expect(html).toContain("Get-Item");
});
test("math in heading does not duplicate katex text in id or toc", async () => {
  const { headings } = await renderMarkdown("# Energy $E=mc^2$", o);
  expect(headings).toEqual([{ depth: 1, id: "energy-emc2", text: "Energy E=mc^2" }]);
});
test("resolveAsset unc, drive root and posix root", () => {
  expect(resolveAsset("\\\\srv\\share\\d", "x.png")).toBe("\\\\srv\\share\\d\\x.png");
  expect(resolveAsset("\\\\srv\\share\\d", "../../x.png")).toBe("\\\\srv\\share\\x.png");
  expect(resolveAsset("D:", "x.png")).toBe("D:\\x.png");
  expect(resolveAsset("", "x.png")).toBe("/x.png");
  expect(resolveAsset("/", "x.png")).toBe("/x.png");
});
test("frontmatter is not rendered", async () => {
  expect((await renderMarkdown("---\ntitle: t\n---\n\n# H", o)).html).not.toContain("title: t");
});

// Safe raw HTML (GitHub-like subset)
test("br inside a table cell is kept", async () => {
  const { html } = await renderMarkdown("|a|\n|-|\n|x<br>y|\n", o);
  expect(html).toMatch(/<td>x<br>y<\/td>/);
});
test("details and summary are preserved", async () => {
  const { html } = await renderMarkdown("<details><summary>S</summary>x</details>", o);
  expect(html).toContain("<details>");
  expect(html).toContain("<summary>S</summary>");
});
test("raw html img is rewritten via assetUrl and keeps width", async () => {
  const { html } = await renderMarkdown('<img src="./그림%201.png" width="100">', { baseDir: "D:\\문서", assetUrl: (a) => "asset://" + a });
  expect(html).toContain('src="asset://D:\\문서\\그림 1.png"');
  expect(html).toContain('width="100"');
});
test("dangerous raw html is removed", async () => {
  const src = '<script>x</script>\n\n<img src=x onerror=y>\n\n<a href="javascript:alert(1)">a</a>\n\n<iframe src=x></iframe>\n\nok';
  const { html } = await renderMarkdown(src, o);
  expect(html).not.toMatch(/<script|onerror|javascript:|<iframe/i);
  expect(html).toContain("ok");
});
test("raw html keeps the github-like subset and drops styles, classes and unsafe urls", async () => {
  const src = [
    '<div align="center"><kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup></div>',
    '<p align="right" style="color:red" class="mermaid">p</p>',
    '<a href="vbscript:x">v</a> <a href="JAVASCRIPT:x">j</a> <a href="https://a.b">ok</a>',
    '<img src="data:text/html,x"> <img src="data:image/png;base64,AA==" alt="d">',
    "<object data=x></object><embed src=x><style>p{}</style><form><input name=q></form>",
    "<details open><summary>S</summary>x</details>",
  ].join("\n\n");
  const { html } = await renderMarkdown(src, o);
  expect(html).toContain('<div align="center"><kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup></div>');
  expect(html).toContain('<p align="right">p</p>');
  expect(html).toContain('href="https://a.b"');
  expect(html).toContain('src="data:image/png;base64,AA=="');
  expect(html).toContain("<details open>");
  expect(html).not.toMatch(/vbscript|javascript|data:text|<object|<embed|<style|<form|<input|style=|class="mermaid"/i);
});
test("drive-letter image paths in raw html and markdown resolve via assetUrl", async () => {
  const { html } = await renderMarkdown('<img src="C:/p/a.png">\n\n![b](C:/p/b.png)', o);
  expect(html).toContain('src="asset://C:/p/a.png"');
  expect(html).toContain('src="asset://C:/p/b.png"');
});
test("task lists, footnotes and math survive sanitizing", async () => {
  const { html } = await renderMarkdown("- [x] done\n\nA[^1] $a$\n\n$$\nb\n$$\n\n[^1]: note", o);
  expect(html).toMatch(/<input type="checkbox" checked disabled>|<input checked type="checkbox" disabled>|<input type="checkbox" disabled checked>/);
  expect(html).toContain('href="#fn-1"');
  expect(html).toContain('id="user-content-fn-1"');
  expect(html).toContain("katex-display");
});

// UNC paths would make the webview/asset handler open an SMB connection (NTLM leak) on render.
const FOREIGN_UNC = [
  "\\\\evil\\share\\x.png",
  "/\\evil\\share\\x.png",
  "\\/evil/share/x.png",
  "%5C%5Cevil%5Cshare%5Cx.png",
  "\\\\?\\UNC\\evil\\share\\x.png",
  "\\\\.\\pipe\\evil",
  "\\\\?\\GLOBALROOT\\Device\\x.png",
  // device paths whose `..` Windows resolves across the drive component
  "\\/.\\C:\\..\\UNC\\evil\\share\\x.png",
  "\\/?\\C:\\..\\UNC\\evil\\s\\x",
  "\\\\.\\C:\\..\\GLOBALROOT\\Device\\Mup\\evil\\s\\x.png",
  "\\\\.\\C:\\..\\pipe\\x",
  "%5C%5C.%5CC:%5C..%5CUNC%5Cevil%5Cshare%5Cx.png",
  "%5C/.%5CC:%5C..%5Cpipe%5Cx",
  "\\\\.\\c:\\p\\x.png",
  "//./C:/x.png",
];
test("foreign unc image sources never reach assetUrl or the html", async () => {
  const seen: string[] = [];
  const opts = { baseDir: "D:\\d", assetUrl: (a: string) => (seen.push(a), "asset://" + a) };
  const src = FOREIGN_UNC.map((s) => `<img src="${s}">`).join("\n\n") + "\n\n![a](/\\evil\\s\\x.png)";
  const { html } = await renderMarkdown(src, opts);
  expect(seen).toEqual([]);
  expect(html).not.toMatch(/evil|pipe|GLOBALROOT|<img src/i);
});
test("resolveAsset only allows unc paths on the document's own share", () => {
  for (const s of FOREIGN_UNC) {
    expect(resolveAsset("D:\\d", s), s).toBeNull();
    expect(resolveAsset("\\\\srv\\share\\d", s), s).toBeNull();
  }
  const unc = "\\\\srv\\share\\d";
  expect(resolveAsset(unc, "./x.png")).toBe("\\\\srv\\share\\d\\x.png");
  expect(resolveAsset(unc, "\\\\srv\\share\\y.png")).toBe("\\\\srv\\share\\y.png");
  expect(resolveAsset(unc, "\\\\SRV\\Share\\y.png")).toBe("\\\\SRV\\Share\\y.png");
  expect(resolveAsset(unc, "\\\\srv\\other\\x.png")).toBeNull();
  expect(resolveAsset(unc, "\\\\evil\\share\\x.png")).toBeNull();
  expect(resolveAsset(unc, "\\\\srv\\share\\..\\..\\evil\\s\\x.png")).toBeNull();
  // `?` starts a query in an href, so verbatim `\\?\` paths are refused rather than guessed at
  expect(resolveAsset("D:\\d", "\\\\?\\C:\\p\\x.png")).toBeNull();
});
test("a document on a unc share still shows its relative images", async () => {
  const { html } = await renderMarkdown("![a](./x.png)", { baseDir: "\\\\srv\\share\\d", assetUrl: (a) => "asset://" + a });
  expect(html).toContain('src="asset://\\\\srv\\share\\d\\x.png"');
});
test("picture sources are dropped (srcset is never rewritten)", async () => {
  const { html } = await renderMarkdown('<picture><source srcset="\\\\evil\\s\\x.png"><img src="https://a.b/x.png"></picture>', o);
  expect(html).not.toMatch(/<source|srcset|evil/i);
  expect(html).toContain('src="https://a.b/x.png"');
});
