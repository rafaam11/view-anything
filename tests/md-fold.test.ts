// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { addSectionFolds, foldAll, REVEAL, requestReveal, reveal } from "../src/md/fold";
import { collectText } from "../src/md/find";

function article() {
  const root = document.createElement("article");
  root.innerHTML = `<h1 id="a">A</h1><p id="a1">a1</p>
    <h2 id="b">B</h2><p id="b1">b1</p><ul id="b2"><li>b2</li></ul>
    <h3 id="c">C</h3><p id="c1">c1</p>
    <h2 id="d">D</h2><p id="d1">d1</p>
    <h1 id="e">E</h1><p id="e1">e1</p>`;
  document.body.replaceChildren(root);
  return root;
}
const hidden = (root: HTMLElement) => [...root.children].filter(c => c.classList.contains("md-folded-away")).map(c => c.id);
const chevron = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`#${id} > .md-fold`)!;

test("a chevron folds a section up to the next heading of the same or a higher level", () => {
  const root = article(), folded = new Set<string>();
  const text = root.textContent;
  addSectionFolds(root, folded);
  expect(root.querySelectorAll(".md-fold")).toHaveLength(5);
  expect(root.textContent).toBe(text); // icon only: the text and find see nothing new
  expect(collectText(root).text).not.toContain("섹션");
  chevron(root, "b").click();
  expect(hidden(root)).toEqual(["b1", "b2", "c", "c1"]);
  expect(chevron(root, "b").getAttribute("aria-expanded")).toBe("false");
  expect(chevron(root, "b").getAttribute("aria-label")).toBe("섹션 펼치기: B");
  // A folded inner section stays folded while its parent opens and closes.
  chevron(root, "b").click(); chevron(root, "c").click(); chevron(root, "a").click();
  expect(hidden(root)).toEqual(["a1", "b", "b1", "b2", "c", "c1", "d", "d1"]);
  chevron(root, "a").click();
  expect(hidden(root)).toEqual(["c1"]);
  expect(root.querySelector("#c")!.classList.contains("md-fold-closed")).toBe(true);
});

test("reaching a hidden block opens every section around it; a reload keeps the folds", () => {
  const root = article(), folded = new Set<string>(["a", "c"]);
  addSectionFolds(root, folded);
  root.addEventListener(REVEAL, (e) => reveal(root, folded, e.target as Element));
  expect(hidden(root)).toEqual(["a1", "b", "b1", "b2", "c", "c1", "d", "d1"]);
  requestReveal(root.querySelector("#c1")!);
  expect([...folded]).toEqual([]);
  expect(hidden(root)).toEqual([]);
  folded.add("b");
  requestReveal(root.querySelector("#d1")!); // not hidden by B: nothing changes
  addSectionFolds(root, folded); // decorated again (no second chevron)
  expect(root.querySelectorAll("#b > .md-fold")).toHaveLength(1);
  expect(hidden(root)).toEqual(["b1", "b2", "c", "c1"]);
  // A fresh render of the same headings (new DOM) gets the same folds.
  const next = article();
  addSectionFolds(next, folded);
  expect(hidden(next)).toEqual(["b1", "b2", "c", "c1"]);
});

test("fold all leaves the top-level headings; unfold all shows everything", () => {
  const root = article(), folded = new Set<string>();
  addSectionFolds(root, folded);
  foldAll(root, folded, true);
  expect([...root.children].filter(c => !c.classList.contains("md-folded-away")).map(c => c.id)).toEqual(["a", "e"]);
  foldAll(root, folded, false);
  expect(hidden(root)).toEqual([]);
});
