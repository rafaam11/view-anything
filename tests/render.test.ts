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
