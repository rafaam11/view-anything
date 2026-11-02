// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { collectText, createFind, createFinder } from "../src/md/find";

function articleOf(html: string): HTMLElement {
  const article = document.createElement("article");
  article.innerHTML = html;
  document.body.append(article);
  return article;
}
const marked = (root: Element) => [...root.querySelectorAll("mark")].map((m) => m.textContent);
const current = (root: Element) => [...root.querySelectorAll(".md-find-current")].map((m) => m.textContent).join("");

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("a match may cross inline formatting and is one result", () => {
  const article = articleOf("<p>hello <strong>wor</strong>ld and more</p>");
  const finder = createFinder(article);
  finder.apply("hello world");
  expect(finder.count).toBe(1);
  expect(marked(article)).toEqual(["hello ", "wor", "ld"]);
  expect(current(article)).toBe("hello world");
});

test("a match crosses highlight tokens in code", () => {
  const article = articleOf('<pre><code><span class="hljs-keyword">const</span> value = <span class="hljs-number">1</span>;\nnext</code></pre>');
  const finder = createFinder(article);
  finder.apply("const value");
  expect(finder.count).toBe(1);
  finder.apply("; next"); // the line break counts as a space
  expect(finder.count).toBe(1);
});

test("marking and clearing never change the text, and clearing restores the structure", () => {
  const html = '<h1 id="a">Title one</h1>\n<p>one <em>on</em>e two</p>\n<ul>\n<li>one</li>\n</ul>';
  const article = articleOf(html);
  const before = article.textContent;
  const finder = createFinder(article);
  finder.apply("one");
  expect(finder.count).toBe(4);
  expect(article.textContent).toBe(before);
  finder.clear();
  expect(article.textContent).toBe(before);
  expect(article.innerHTML).toBe(html);
  expect(finder.count).toBe(0);
});

test("matches do not reach across blocks", () => {
  const article = articleOf("<p>end</p>\n<p>start</p><ul><li>a</li><li>b</li></ul><table><tr><td>c</td><td>d</td></tr></table>");
  const finder = createFinder(article);
  for (const query of ["end start", "endstart", "ab", "a b", "cd", "c d"]) {
    finder.apply(query);
    expect(finder.count, query).toBe(0);
  }
});

test("a line break inside a paragraph counts as a space", () => {
  const article = articleOf("<p>one<br>two three\nfour</p>");
  const finder = createFinder(article);
  finder.apply("one two");
  expect(finder.count).toBe(1);
  expect(marked(article)).toEqual(["one", "two"]);
  finder.apply("three four");
  expect(finder.count).toBe(1);
});

test("a space that only stands for a line break is not a result", () => {
  const article = articleOf("<p>one<br>two</p>");
  const finder = createFinder(article);
  finder.apply(" ");
  expect(finder.count).toBe(0);
  expect(article.querySelector("mark")).toBeNull();
});

test("whitespace between blocks is no match, but a space between inline elements is", () => {
  const article = articleOf("<p>a</p>\n<p><b>x</b> <i>y</i></p>\n");
  expect(collectText(article).text).not.toContain("\n");
  const finder = createFinder(article);
  finder.apply(" ");
  expect(finder.count).toBe(1);
  finder.apply("x y");
  expect(finder.count).toBe(1);
});

test("diagrams, math and the copy button are not searched", () => {
  const article = articleOf('<div class="mermaid">graph secret</div><span class="katex">secret</span><svg><text>secret</text></svg><div class="md-code"><pre>code</pre><button class="md-code-copy">secret</button></div><p>plain</p>');
  const finder = createFinder(article);
  finder.apply("secret");
  expect(finder.count).toBe(0);
  finder.apply("code");
  expect(finder.count).toBe(1);
});

test("the query is literal and ignores case", () => {
  const article = articleOf("<p>a.b axb A.B (c)</p>");
  const finder = createFinder(article);
  finder.apply("a.b");
  expect(finder.count).toBe(2);
  finder.apply("(C)");
  expect(finder.count).toBe(1);
});

test("stepping wraps around and moves the current mark", () => {
  const article = articleOf("<p>one two one</p><p>one</p>");
  const finder = createFinder(article);
  finder.apply("one");
  expect(finder.index).toBe(0);
  finder.step(-1);
  expect(finder.index).toBe(2);
  expect(article.querySelectorAll(".md-find-current").length).toBe(1);
  finder.step(1);
  expect(finder.index).toBe(0);
  expect(article.querySelector(".md-find-current")!.parentElement!.textContent).toBe("one two one");
});

test("the search starts from what is on screen", () => {
  const article = articleOf("<p>one</p><p>one</p><p>one</p>");
  const tops = new Map<Element, number>([...article.querySelectorAll("p")].map((p, i) => [p, [-300, 40, 500][i]]));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { top: tops.get(this.parentElement!) ?? 0, height: 20 } as DOMRect;
  });
  const finder = createFinder(article);
  finder.apply("one");
  expect(finder.index).toBe(1);
});

test("a result in closed details opens them, however deep, and only when it is reached", () => {
  const article = articleOf("<p>one</p><details><summary>s</summary><details><p>one</p></details></details>");
  const finder = createFinder(article);
  finder.apply("one");
  const all = [...article.querySelectorAll("details")];
  expect(all.map((d) => d.open)).toEqual([false, false]);
  finder.step(1);
  expect(all.map((d) => d.open)).toEqual([true, true]);
});

test("moving to a result scrolls to it, but refreshing after a reload does not", () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const article = articleOf("<p>one</p><p>one</p><p>one</p>");
  const finder = createFinder(article);
  finder.apply("one");
  finder.step(1);
  finder.step(1);
  scroll.mockClear();
  article.innerHTML = "<p>one</p><p>one</p><p>one</p><p>one</p>";
  finder.refresh();
  expect(finder.count).toBe(4);
  expect(finder.index).toBe(2);
  expect(current(article)).toBe("one");
  expect(scroll).not.toHaveBeenCalled();
  article.innerHTML = "<p>one</p>";
  finder.refresh();
  expect(finder.index).toBe(0);
  article.innerHTML = "<p>removed</p>";
  finder.refresh();
  expect(finder.count).toBe(0);
  expect(finder.index).toBe(-1);
});

test("the panel debounces typing; Enter shows the first result, then moves", () => {
  vi.useFakeTimers();
  try {
    const article = articleOf("<p>one</p><p>one</p><p>one</p>");
    const panel = createFind(article);
    document.body.append(panel.element);
    panel.open();
    const input = panel.element.querySelector("input")!;
    const count = panel.element.querySelector(".md-find-count")!;
    const enter = (shiftKey = false) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, cancelable: true }));
    input.value = "one";
    input.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("");
    enter(); // before the debounce fired: does not skip the first result
    expect(count.textContent).toBe("1/3");
    enter();
    expect(count.textContent).toBe("2/3");
    enter(true);
    expect(count.textContent).toBe("1/3");
    input.value = "nothing";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(100);
    expect(count.textContent).toBe("결과 없음");
  } finally {
    vi.useRealTimers();
  }
});

test("Enter while composing Hangul belongs to the IME", () => {
  const article = articleOf("<p>한글</p><p>한글</p>");
  const panel = createFind(article);
  panel.open();
  const input = panel.element.querySelector("input")!;
  input.value = "한글";
  input.dispatchEvent(new Event("input"));
  const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(article.querySelector("mark")).toBeNull();
  panel.close();
});

test("closing removes marks, cancels pending typing and forgets the query", () => {
  vi.useFakeTimers();
  try {
    const article = articleOf("<p>one</p>");
    const panel = createFind(article);
    panel.open();
    expect(panel.isOpen).toBe(true);
    const input = panel.element.querySelector("input")!;
    input.value = "one";
    input.dispatchEvent(new Event("input"));
    panel.close();
    vi.advanceTimersByTime(200);
    expect(panel.isOpen).toBe(false);
    expect(article.querySelector("mark")).toBeNull();
    expect(input.value).toBe("");
  } finally {
    vi.useRealTimers();
  }
});
