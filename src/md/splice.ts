import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";

export class SpliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpliceError";
  }
}

export interface Block {
  start: number;
  end: number;
  /** Structural signature: node type plus heading depth / list ordering where relevant. */
  kind: string;
}

function blockKind(node: { type: string; depth?: number; ordered?: boolean | null }): string {
  if (node.type === "heading") return `heading:${node.depth}`;
  if (node.type === "list") return `list:${node.ordered ? "ordered" : "bullet"}`;
  return node.type;
}

/** Parser shared by save-splicing and rendering, so both agree on block boundaries. */
export function mdProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkFrontmatter, ["yaml"]);
}

/** Source offsets of the top-level mdast blocks (`root.children`). */
export function splitBlocks(md: string): Block[] {
  const root = mdProcessor().parse(md);
  return root.children.map((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) throw new SpliceError(`block without position: ${node.type}`);
    return { start, end, kind: blockKind(node) };
  });
}

/** Pairs (i, j) of an LCS of a and b, in increasing order. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** An output block: either taken from / replacing original block `orig`, or brand new. */
interface Item {
  text: string;
  orig?: number;
  /** True when the text is the untouched original block. */
  matched: boolean;
}

/** A gap that contains a blank line safely separates any two blocks. */
const BLANK_LINE = /\n[ \t]*\n/;

/**
 * Apply the edits between `baseline` and `edited` to `original`, touching only changed blocks.
 * All inputs are LF-normalized. `baseline` is the editor's serialization of `original` right
 * after load. Returns null when nothing changed.
 */
export function spliceMarkdown(original: string, baseline: string, edited: string): string | null {
  if (edited === baseline) return null;

  const O = splitBlocks(original);
  const B = splitBlocks(baseline);
  if (O.length !== B.length) {
    throw new SpliceError(`block count mismatch: original ${O.length}, baseline ${B.length}`);
  }
  O.forEach((o, i) => {
    if (o.kind !== B[i].kind) {
      throw new SpliceError(`block ${i} structure mismatch: original ${o.kind}, baseline ${B[i].kind}`);
    }
  });
  // Nothing to preserve in a file without blocks (empty or whitespace only).
  // Any leading/trailing whitespace of such a file is intentionally dropped.
  if (O.length === 0) return edited;

  const E = splitBlocks(edited);
  const bText = B.map((b) => baseline.slice(b.start, b.end));
  const eText = E.map((e) => edited.slice(e.start, e.end));
  const oText = O.map((o) => original.slice(o.start, o.end));

  const items: Item[] = [];
  // Unmatched runs between matched anchors: pair positionally (edit in place),
  // surplus edited blocks are new, surplus baseline blocks are deleted.
  const flushRun = (bFrom: number, bTo: number, eFrom: number, eTo: number) => {
    const k = Math.min(bTo - bFrom, eTo - eFrom);
    for (let t = 0; t < k; t++) items.push({ text: eText[eFrom + t], orig: bFrom + t, matched: false });
    for (let j = eFrom + k; j < eTo; j++) items.push({ text: eText[j], matched: false });
  };
  let bi = 0;
  let ej = 0;
  for (const [i, j] of lcsPairs(bText, eText)) {
    flushRun(bi, i, ej, j);
    items.push({ text: oText[i], orig: i, matched: true });
    bi = i + 1;
    ej = j + 1;
  }
  flushRun(bi, B.length, ej, E.length);

  let out = original.slice(0, O[0].start);
  let prev: Item | undefined;
  for (const item of items) {
    if (prev) {
      let gap = "\n\n";
      if (prev.orig !== undefined && item.orig !== undefined) {
        // Across deleted blocks, reuse the gap after `prev`.
        const orig = original.slice(O[prev.orig].end, O[prev.orig + 1].start);
        const untouched = prev.matched && item.matched && item.orig === prev.orig + 1;
        // Untouched neighbours keep their gap byte-exact. Next to an edit or a deletion a tight
        // gap ("\n") could merge blocks (lazy continuation, setext heading), so require a blank line.
        if (untouched || BLANK_LINE.test(orig)) gap = orig;
      }
      out += gap;
    }
    out += item.text;
    prev = item;
  }
  out += original.slice(O[O.length - 1].end);
  return out === original ? null : out;
}

/**
 * Split a leading YAML frontmatter block (plus the gap after it) off `md`. The editor has no
 * frontmatter node, so it only ever sees `body`; `head` is re-attached byte-exact on save.
 */
export function splitFrontmatter(md: string): { head: string; body: string } {
  const blocks = splitBlocks(md);
  if (blocks[0]?.kind !== "yaml") return { head: "", body: md };
  const cut = blocks.length > 1 ? blocks[1].start : md.length;
  return { head: md.slice(0, cut), body: md.slice(cut) };
}

/** Inverse of `splitFrontmatter`; inserts a line break only if `head` does not end with one. */
export function joinFrontmatter(head: string, body: string): string {
  return head && body && !head.endsWith("\n") ? head + "\n" + body : head + body;
}
