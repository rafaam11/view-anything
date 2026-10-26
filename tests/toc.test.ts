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
