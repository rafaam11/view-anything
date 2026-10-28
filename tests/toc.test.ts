// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { buildToc } from "../src/md/toc";

test("dispose removes the scroll listener so re-renders do not accumulate them", () => {
  const article = document.createElement("article");
  article.innerHTML = '<h1 id="a">A</h1><h2 id="b">B</h2>';
  document.body.append(article);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { nav, dispose } = buildToc(
    [
      { depth: 1, id: "a", text: "A" },
      { depth: 2, id: "b", text: "B" },
    ],
    article,
  );
  expect(nav.querySelectorAll("a")).toHaveLength(2);
  const added = add.mock.calls.filter((c) => c[0] === "scroll");
  expect(added).toHaveLength(1);
  dispose();
  const removed = remove.mock.calls.filter((c) => c[0] === "scroll");
  expect(removed).toHaveLength(1);
  expect(removed[0][1]).toBe(added[0][1]);
});

test("tracks the app scroll container below the custom titlebar", async () => {
  const scroller = document.createElement("main");
  const article = document.createElement("article");
  article.innerHTML = '<h1 id="c">C</h1><h2 id="d">D</h2>';
  scroller.append(article);
  document.body.append(scroller);
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 32 } as DOMRect);
  vi.spyOn(article.querySelector("h1")!, "getBoundingClientRect").mockReturnValue({ top: 68 } as DOMRect);
  const heading = vi.spyOn(article.querySelector("h2")!, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);
  const remove = vi.spyOn(scroller, "removeEventListener");
  const { nav, dispose } = buildToc([{ depth: 1, id: "c", text: "C" }, { depth: 2, id: "d", text: "D" }], article, scroller);
  await Promise.resolve();
  expect(nav.querySelector("a.active")?.textContent).toBe("C");
  heading.mockReturnValue({ top: 100 } as DOMRect);
  scroller.dispatchEvent(new Event("scroll"));
  expect(nav.querySelector("a.active")?.textContent).toBe("D");
  dispose();
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  scroller.remove();
});

test("selects the final heading at the bottom even if it cannot reach the top threshold", async () => {
  const scroller = document.createElement("main"), article = document.createElement("article");
  article.innerHTML = '<h1 id="bottom-a">A</h1><h2 id="bottom-b">B</h2><h2 id="bottom-c">C</h2>';
  scroller.append(article); document.body.append(scroller);
  Object.defineProperties(scroller, { clientHeight: { value: 500 }, scrollHeight: { value: 1000 }, scrollTop: { value: 400, writable: true } });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 32 } as DOMRect);
  const headings = [...article.querySelectorAll("h1,h2")];
  headings.forEach((h, i) => vi.spyOn(h, "getBoundingClientRect").mockReturnValue({ top: [40, 200, 450][i] } as DOMRect));
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  const { nav, dispose } = buildToc(headings.map((h, i) => ({ id: h.id, text: h.textContent!, depth: i ? 2 : 1 })), article, scroller);
  await Promise.resolve(); expect(nav.querySelector("a.active")?.textContent).toBe("A");
  scroller.scrollTop = 499.5; scroller.dispatchEvent(new Event("scroll"));
  expect(nav.querySelector("a.active")?.textContent).toBe("C");
  expect(scrollIntoView).not.toHaveBeenCalled();
  scroller.scrollTop = 350; scroller.dispatchEvent(new Event("scroll"));
  expect(nav.querySelector("a.active")?.textContent).toBe("A");
  dispose(); scroller.remove(); scrollIntoView.mockRestore();
});
