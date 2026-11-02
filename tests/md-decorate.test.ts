// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { addCodeCopyButtons, imagesReady } from "../src/md/decorate";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function rootOf(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

afterEach(() => vi.useRealTimers());

test("each code block gets a button outside the scrolling block, and copies without the final line break", async () => {
  const root = rootOf('<pre><code><span class="hljs-keyword">const</span> a;\nb\n</code></pre><p>x</p><pre>plain\n</pre>');
  const copy = vi.fn(async () => {});
  addCodeCopyButtons(root, copy, () => {});
  const frames = root.querySelectorAll(".md-code");
  expect(frames.length).toBe(2);
  expect(root.querySelectorAll("pre button").length).toBe(0);
  frames[0].querySelector("button")!.click();
  expect(copy).toHaveBeenLastCalledWith("const a;\nb");
  frames[1].querySelector("button")!.click();
  expect(copy).toHaveBeenLastCalledWith("plain");
});

test("the button adds no text to the document", () => {
  const root = rootOf("<pre><code>code\n</code></pre>");
  const before = root.textContent;
  addCodeCopyButtons(root, async () => {}, () => {});
  expect(root.textContent).toBe(before);
});

test("copied feedback appears and goes away", async () => {
  vi.useFakeTimers();
  const root = rootOf("<pre>x</pre>");
  addCodeCopyButtons(root, async () => {}, () => {});
  const button = root.querySelector("button")!;
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(button.classList.contains("copied")).toBe(true);
  expect(button.getAttribute("aria-label")).toBe("복사됨");
  await vi.advanceTimersByTimeAsync(1500);
  expect(button.classList.contains("copied")).toBe(false);
  expect(button.getAttribute("aria-label")).toBe("코드 복사");
});

test("a failed copy is reported and shows no success", async () => {
  const root = rootOf("<pre>x</pre>");
  const onError = vi.fn();
  addCodeCopyButtons(root, async () => { throw new Error("busy"); }, onError);
  const button = root.querySelector("button")!;
  button.click();
  await settle();
  expect(onError).toHaveBeenCalledOnce();
  expect(button.classList.contains("copied")).toBe(false);
});

test("a click on the button does not reach a link around the block", () => {
  const root = rootOf('<a href="https://a.b"><pre>x</pre></a>');
  const follow = vi.fn();
  root.addEventListener("click", follow);
  addCodeCopyButtons(root, async () => {}, () => {});
  root.querySelector("button")!.click();
  expect(follow).not.toHaveBeenCalled();
});

test("images that never finish do not hold the content back", async () => {
  vi.useFakeTimers();
  const root = rootOf('<img src="a.png"><img src="b.png">');
  const images = root.querySelectorAll("img");
  images[0].decode = () => new Promise(() => {});
  images[1].decode = () => Promise.reject(new Error("broken"));
  let done = false;
  void imagesReady(root).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(1499);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
});

test("broken images count as ready", async () => {
  const root = rootOf('<img src="a.png">');
  root.querySelector("img")!.decode = () => Promise.reject(new Error("broken"));
  await imagesReady(root);
});
