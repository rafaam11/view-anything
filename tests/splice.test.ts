import { describe, expect, test } from "vitest";
import { SpliceError, spliceMarkdown, splitBlocks } from "../src/md/splice";
import { decodeText, encodeText } from "../src/md/text";

const orig = "---\ntitle: x\n---\n\n* a\n* b\n\n| a |  b |\n|:--|--:|\n| 1 | 2 |\n\npara one\n\npara two";
// baseline: mimics editor serialization (list markers and table alignment change)
const base = "---\ntitle: x\n---\n\n- a\n- b\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n\npara one\n\npara two\n";

test("splitBlocks returns top-level block offsets", () => {
  const md = "---\nt: 1\n---\n\n# h\n\n$$\nx\n$$\n\n| a |\n|---|\n| 1 |\n";
  const blocks = splitBlocks(md).map((b) => md.slice(b.start, b.end));
  expect(blocks).toEqual(["---\nt: 1\n---", "# h", "$$\nx\n$$", "| a |\n|---|\n| 1 |"]);
});

test("no change returns null", () => expect(spliceMarkdown(orig, base, base)).toBeNull());

test("only edited block changes", () => {
  const out = spliceMarkdown(orig, base, base.replace("para two", "para 2"))!;
  expect(out).toBe(orig.replace("para two", "para 2"));
});

test("inserted block lands between original neighbours", () => {
  const out = spliceMarkdown(orig, base, base.replace("para one\n", "para one\n\nnew\n"))!;
  expect(out).toBe(orig.replace("para one\n", "para one\n\nnew\n"));
});

test("deleted block removes only that block", () => {
  const out = spliceMarkdown(orig, base, base.replace("para one\n\n", ""))!;
  expect(out).toBe(orig.replace("para one\n\n", ""));
  expect(out).toBe("---\ntitle: x\n---\n\n* a\n* b\n\n| a |  b |\n|:--|--:|\n| 1 | 2 |\n\npara two");
});

test("splice throws on block count mismatch", () => {
  expect(() => spliceMarkdown("a\n\nb", "a b", "a c")).toThrow(SpliceError);
});

test("splice preserves CRLF and BOM and missing trailing newline", () => {
  const BOM = [0xef, 0xbb, 0xbf];
  const enc = (s: string) => new TextEncoder().encode(s);
  const src = "---\r\ntitle: x\r\n---\r\n\r\n* a\r\n* b\r\n\r\n<div>\r\n  raw\r\n</div>\r\n\r\npara one\r\n\r\npara two";
  const bytes = new Uint8Array([...BOM, ...enc(src)]);
  const d = decodeText(bytes);
  const baseline = "---\ntitle: x\n---\n\n- a\n- b\n\n<div>\n  raw\n</div>\n\npara one\n\npara two\n";
  const out = spliceMarkdown(d.text, baseline, baseline.replace("para one", "para 1"))!;
  const written = encodeText(out, d);
  const expected = new Uint8Array([...BOM, ...enc(src.replace("para one", "para 1"))]);
  expect(written).toEqual(expected);
});

describe("review fix round 1", () => {
  test("deletion across a tight gap does not merge neighbouring paragraphs", () => {
    expect(spliceMarkdown("para\n* a\n\nq\n", "para\n\n- a\n\nq\n", "para\n\nq\n")).toBe("para\n\nq\n");
  });

  test("edited block after a tight gap does not become lazy continuation", () => {
    expect(spliceMarkdown("para\n* a\n", "para\n\n- a\n", "para\n\nb\n")).toBe("para\n\nb\n");
  });

  test("edited block before a tight gap does not become setext heading", () => {
    expect(spliceMarkdown("# h\n---\n", "# h\n\n---\n", "text\n\n---\n")).toBe("text\n\n---\n");
  });

  test("tight gap between unchanged matched blocks stays byte-exact", () => {
    expect(spliceMarkdown("para\n* a\n\nq\n", "para\n\n- a\n\nq\n", "para\n\n- a\n\nQ\n")).toBe("para\n* a\n\nQ\n");
  });

  test("original and baseline with equal count but different structure throws", () => {
    expect(() =>
      spliceMarkdown("x\n\n* b\n- c\n\nd", "x\n\n- b\n- c\n\nd1\n\nd2\n", "x\n\n- b\n- c\n\nD1\n\nd2\n"),
    ).toThrow(SpliceError);
  });

  test("structure check covers heading depth and list ordering", () => {
    expect(() => spliceMarkdown("# a\n\nb", "## a\n\nb\n", "## a\n\nc\n")).toThrow(SpliceError);
    expect(() => spliceMarkdown("1. a\n\nb", "- a\n\nb\n", "- a\n\nc\n")).toThrow(SpliceError);
  });

  test("splice result identical to original returns null", () => {
    expect(spliceMarkdown("a\n\nb", "a\n\nb\n", "a\n\nb")).toBeNull();
  });
});

describe("adversarial inputs", () => {
  test("edited block keeps unusual surrounding gaps", () => {
    const o = "a\n\n\n\nb\n\n\nc";
    const b = "a\n\nb\n\nc\n";
    expect(spliceMarkdown(o, b, "a\n\nB\n\nc\n")).toBe("a\n\n\n\nB\n\n\nc");
  });

  test("block edited into two blocks: first in place, second appended", () => {
    const out = spliceMarkdown(orig, base, base.replace("para one", "para X\n\nsplit"))!;
    expect(out).toBe(orig.replace("para one", "para X\n\nsplit"));
  });

  test("duplicate identical blocks: only the edited occurrence changes", () => {
    const o = "x\n\n* y\n\nx\n\n* y";
    const b = "x\n\n- y\n\nx\n\n- y\n";
    expect(spliceMarkdown(o, b, "x\n\n- y\n\nz\n\n- y\n")).toBe("x\n\n* y\n\nz\n\n* y");
  });

  test("deleting the first block (frontmatter) drops it with its following gap", () => {
    const out = spliceMarkdown(orig, base, base.replace("---\ntitle: x\n---\n\n", ""))!;
    expect(out).toBe(orig.replace("---\ntitle: x\n---\n\n", ""));
  });

  test("deleting the last block keeps the original tail", () => {
    const o = "a\n\n\nb\n";
    expect(spliceMarkdown(o, "a\n\nb\n", "a\n")).toBe("a\n");
  });

  test("all blocks deleted leaves leading gap and tail", () => {
    expect(spliceMarkdown("a\n\nb\n", "a\n\nb\n", "")).toBe("\n");
  });

  test("insert before first block keeps leading gap", () => {
    expect(spliceMarkdown("\n\na\n", "a\n", "new\n\na\n")).toBe("\n\nnew\n\na\n");
  });

  test("file that is only frontmatter gains a block", () => {
    const o = "---\na: 1\n---\n";
    expect(spliceMarkdown(o, o, o + "\nhello\n")).toBe("---\na: 1\n---\n\nhello\n");
  });

  test("empty original takes edited text", () => {
    expect(spliceMarkdown("", "", "hello\n")).toBe("hello\n");
  });

  test("html block and table untouched while list edited", () => {
    const o = "<div align=center>\n  <b>x</b>\n</div>\n\n* a\n* b\n\n|a|b|\n|-|-|\n|1|2|\n";
    const b = "<div align=center>\n  <b>x</b>\n</div>\n\n- a\n- b\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const e = b.replace("- b", "- c");
    expect(spliceMarkdown(o, b, e)).toBe("<div align=center>\n  <b>x</b>\n</div>\n\n- a\n- c\n\n|a|b|\n|-|-|\n|1|2|\n");
  });
});

describe("link reference definitions", () => {
  // Editors inline reference links and drop the definitions; the original keeps both.
  const withDefs = "# T\n\nsee [x][r] here\n\n[r]: https://x.example\n\npara two\n\n[s]: https://s.example \"S\"\n";
  const defBase = "# T\n\nsee [x](https://x.example) here\n\npara two\n";

  test("unchanged editor writes nothing", () => {
    expect(spliceMarkdown(withDefs, defBase, defBase)).toBeNull();
  });

  test("editing another paragraph keeps definition bytes in place", () => {
    const out = spliceMarkdown(withDefs, defBase, defBase.replace("para two", "para 2"));
    expect(out).toBe(withDefs.replace("para two", "para 2"));
  });

  test("editing the block before a definition keeps the definition", () => {
    const out = spliceMarkdown(withDefs, defBase, defBase.replace("# T", "# Title"));
    expect(out).toBe(withDefs.replace("# T", "# Title"));
  });

  test("editing the block next to a definition keeps the definition", () => {
    const out = spliceMarkdown(withDefs, defBase, defBase.replace("see [x](https://x.example) here", "changed"));
    expect(out).toBe(withDefs.replace("see [x][r] here", "changed"));
  });

  test("deleting the block around a definition keeps the definition", () => {
    const out = spliceMarkdown(withDefs, defBase, defBase.replace("para two\n", ""))!;
    expect(out).toContain("[r]: https://x.example");
    expect(out).toContain('[s]: https://s.example "S"');
    expect(out).not.toContain("para two");
  });

  test("tight definition between blocks survives an adjacent edit", () => {
    const md = "# A\n[r]: https://x\n# B\n";
    const base = "# A\n\n# B\n";
    const out = spliceMarkdown(md, base, "# A\n\n# B2\n")!;
    expect(out).toContain("[r]: https://x");
    expect(splitBlocks(out).map((b) => b.kind)).toEqual(["heading:1", "definition", "heading:1"]);
    expect(out.startsWith("# A")).toBe(true);
    expect(out).toContain("# B2");
  });

  test("definitions in the editor output are ignored for alignment", () => {
    const base = "# T\n\nsee [x][r] here\n\n[r]: https://x.example\n\npara two\n";
    expect(spliceMarkdown(withDefs, base, base.replace("para two", "para 2"))).toBe(
      withDefs.replace("para two", "para 2"),
    );
  });
});
