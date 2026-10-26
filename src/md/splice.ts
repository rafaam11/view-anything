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

  // Link reference definitions take no part in alignment: editors resolve reference links
  // inline and drop the definitions. The original ones are re-emitted with their own bytes.
  const all = splitBlocks(original);
  const O = all.filter((b) => !isDefinition(b));
  const defs = all.filter(isDefinition);
  const B = splitBlocks(baseline).filter((b) => !isDefinition(b));
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
  if (O.length === 0) return defs.length ? original.trimEnd() + "\n\n" + edited : edited;

  const E = splitBlocks(edited).filter((b) => !isDefinition(b));
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

  // Definitions by slot: slot s lies between O[s-1] and O[s] (slot 0 before O[0], slot n after
  // the last block). Every slot is emitted exactly once, in order, with its definition bytes exact.
  const n = O.length;
  const slots: Block[][] = Array.from({ length: n + 1 }, () => []);
  for (const d of defs) slots[O.filter((o) => o.end <= d.start).length].push(d);
  let nextSlot = 0;
  /** Non-empty slots up to and including `to` that were not emitted yet. */
  const take = (to: number): number[] => {
    const taken: number[] = [];
    for (; nextSlot <= Math.min(to, n); nextSlot++) if (slots[nextSlot].length) taken.push(nextSlot);
    return taken;
  };
  const first = (s: number) => slots[s][0];
  const last = (s: number) => slots[s][slots[s].length - 1];
  /** Bytes between the block before slot s and its first definition. */
  const lead = (s: number) => original.slice(s === 0 ? 0 : O[s - 1].end, first(s).start);
  /** Bytes between the last definition of slot s and the block after it (or the end of file). */
  const trail = (s: number) => original.slice(last(s).end, s === n ? original.length : O[s].start);
  const runs = (taken: number[]) => taken.map((s) => original.slice(first(s).start, last(s).end)).join("\n\n");
  // Next to an edit, insertion or deletion a tight gap ("\n") could merge blocks (lazy paragraph
  // continuation, setext heading; a definition cannot interrupt a paragraph): require a blank line.
  const safe = (gap: string) => (BLANK_LINE.test(gap) ? gap : "\n\n");

  let out = "";
  let prev: Item | undefined;
  for (const item of items) {
    // New blocks at the very start come after the leading definitions.
    const pending = take(item.orig ?? (prev ? -1 : 0));
    if (!prev) {
      if (pending.length === 0) {
        out += original.slice(0, O[0].start); // leading whitespace only (slot 0 is empty)
      } else {
        // Untouched first block: the prefix stays byte-exact.
        const untouched = item.matched && item.orig === 0;
        const end = pending[pending.length - 1];
        out += (pending[0] === 0 ? lead(0) : "") + runs(pending) + (untouched ? trail(end) : safe(trail(end)));
      }
    } else {
      const untouched =
        prev.matched && item.matched && prev.orig !== undefined && item.orig === prev.orig + 1;
      if (untouched) {
        // Untouched neighbours keep their gap (including any definitions in it) byte-exact.
        out += original.slice(O[prev.orig!].end, O[item.orig!].start);
      } else if (pending.length) {
        out += safe(lead(pending[0])) + runs(pending) + safe(trail(pending[pending.length - 1]));
      } else if (prev.orig !== undefined && item.orig !== undefined) {
        // Across deleted blocks, reuse the gap after `prev` (it holds no definitions here).
        out += safe(original.slice(O[prev.orig].end, O[prev.orig + 1].start));
      } else {
        out += "\n\n";
      }
    }
    out += item.text;
    prev = item;
  }

  const rest = take(n);
  if (rest.length === 0) {
    out += original.slice(O[n - 1].end); // trailing whitespace only (slot n is empty)
  } else {
    const end = rest[rest.length - 1];
    const untouched = prev?.matched === true && prev.orig === n - 1 && rest.length === 1 && end === n;
    if (untouched) {
      out += original.slice(O[n - 1].end);
    } else {
      const before = prev ? safe(lead(rest[0])) : rest[0] === 0 ? lead(0) : "";
      const after = end === n ? trail(n) : (/\s*$/.exec(original)?.[0] ?? "");
      out += before + runs(rest) + after;
    }
  }
  return out === original ? null : out;
}

function isDefinition(b: Block): boolean {
  return b.kind === "definition";
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
