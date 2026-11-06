import { findBar } from "../ui/find-bar";
import { matchRanges } from "../ui/match";

const HIT = "md-find-hit", CURRENT = "md-find-current";
/** Rendered diagrams and math keep their text in markup the reader does not see as text. */
const SKIP = ".mermaid, .katex, .md-code-copy, script, style, svg";
const BLOCKS = new Set(["ARTICLE", "ASIDE", "BLOCKQUOTE", "CAPTION", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"]);
/** Between blocks, so a query never matches across two paragraphs. A query cannot contain it. */
const BOUNDARY = "\0";

export interface TextIndex { text: string; nodes: { node: Text; start: number }[] }

const isBlock = (node: Node | null) => node?.nodeType === Node.ELEMENT_NODE && BLOCKS.has((node as Element).tagName);
/** Whitespace the source put around block tags: never rendered, so it must not be a match. */
function isLayoutOnly(t: Text): boolean {
  if (/\S/.test(t.data) || t.parentElement?.closest("pre")) return false;
  return isBlock(t.previousSibling ?? t.parentNode) || isBlock(t.nextSibling ?? t.parentNode);
}

/** The searchable text under root, with each text node's position in it. */
export function collectText(root: Element): TextIndex {
  let text = "";
  const nodes: TextIndex["nodes"] = [];
  const visit = (parent: Node) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text;
        if (isLayoutOnly(t)) continue;
        nodes.push({ node: t, start: text.length });
        text += t.data.replace(/[\r\n\t ]/g, " "); // same length: offsets stay valid
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (element.matches(SKIP)) continue;
        if (element.tagName === "BR") { text += " "; continue; }
        const block = BLOCKS.has(element.tagName);
        if (block) text += BOUNDARY;
        visit(element);
        if (block) text += BOUNDARY;
      }
    }
  };
  visit(root);
  return { text, nodes };
}

function wrap(node: Text, from: number, to: number): HTMLElement {
  if (to < node.length) node.splitText(to);
  const middle = from > 0 ? node.splitText(from) : node;
  const mark = document.createElement("mark");
  mark.className = HIT;
  middle.replaceWith(mark);
  mark.append(middle);
  return mark;
}

/** Wraps each range in marks, one per text node it touches. Returns them per range, in order. */
export function markRanges(nodes: TextIndex["nodes"], ranges: Array<[number, number]>): HTMLElement[][] {
  const hits: HTMLElement[][] = ranges.map(() => []);
  // Backwards: splitting a text node leaves the offsets before the split valid.
  let r = ranges.length - 1;
  for (let n = nodes.length - 1; n >= 0 && r >= 0; n--) {
    const { node, start } = nodes[n], end = start + node.length;
    while (r >= 0 && ranges[r][1] > start) {
      const [from, to] = ranges[r];
      if (from < end) hits[r].unshift(wrap(node, Math.max(from, start) - start, Math.min(to, end) - start));
      if (from < start) break; // it continues in an earlier node
      r--;
    }
  }
  return hits.filter((marks) => marks.length > 0); // a space that only stands for a <br>
}

export function unmark(root: Element): void {
  const parents = new Set<Node>();
  for (const mark of root.querySelectorAll(`mark.${HIT}`)) {
    parents.add(mark.parentNode!);
    mark.replaceWith(...mark.childNodes);
  }
  for (const parent of parents) parent.normalize();
}

/** Highlights matches inside root. The marks change the DOM but never its text. */
export function createFinder(root: Element) {
  let query = "";
  let hits: HTMLElement[][] = [];
  let current = -1;
  const search = () => {
    unmark(root);
    hits = [];
    if (!query) return;
    const { text, nodes } = collectText(root);
    hits = markRanges(nodes, matchRanges(text, query));
  };
  const select = (index: number, reveal: boolean) => {
    hits[current]?.forEach((mark) => mark.classList.remove(CURRENT));
    current = hits.length ? (index + hits.length) % hits.length : -1;
    const marks = hits[current];
    if (!marks) return;
    marks.forEach((mark) => mark.classList.add(CURRENT));
    if (!reveal) return;
    for (let d = marks[0].closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    marks[0].scrollIntoView({ block: "center" });
  };
  /** Starting from what is on screen keeps a search from throwing the reader back to the top. */
  const firstInView = () => {
    const index = hits.findIndex(([mark]) => {
      const box = mark.getBoundingClientRect();
      return box.height > 0 && box.top >= 0;
    });
    return Math.max(index, 0);
  };
  return {
    apply(next: string) { query = next; search(); select(firstInView(), true); },
    step(delta: 1 | -1) { if (hits.length) select(current + delta, true); },
    clear() { query = ""; search(); current = -1; },
    /** After the content was replaced: same query and position, and the scroll stays put. */
    refresh() {
      if (!query) return;
      const keep = current;
      search();
      current = -1;
      select(Math.min(Math.max(keep, 0), hits.length - 1), false);
    },
    get query() { return query; },
    get count() { return hits.length; },
    get index() { return current; },
  };
}

/** The shared floating find bar over the text, so opening it moves neither the text nor the toc. */
export function createFind(root: Element) {
  const finder = createFinder(root);
  const show = () => {
    bar.count.textContent = !finder.query ? "" : finder.count ? `${finder.index + 1}/${finder.count}` : "결과 없음";
  };
  const bar = findBar({
    label: "문서 내 찾기",
    debounce: 100,
    input: (query) => { finder.apply(query); show(); },
    step: (back) => { finder.step(back ? -1 : 1); show(); },
    close: () => finder.clear(),
  });
  return {
    element: bar.element,
    get isOpen() { return bar.isOpen; },
    open: bar.open,
    close: bar.close,
    refresh() { finder.refresh(); show(); },
  };
}
