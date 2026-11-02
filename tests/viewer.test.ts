// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { platform } from "../src/platform";
import { applyPreferences, DEFAULTS, preferences } from "../src/settings/preferences";

const disk = new Map<string, Uint8Array>();
/** Modification times for fileStat, for changes that keep the file's length. */
const stamps = new Map<string, number>();
/** When set, the next readFile waits for it (simulates a slow focus re-read). */
let gate: Promise<void> | null = null;
const enc = (s: string) => new TextEncoder().encode(s);

vi.mock("../src/platform", () => ({
  platform: {
    readFile: async (p: string) => {
      const g = gate;
      gate = null;
      if (g) await g;
      const b = disk.get(p);
      if (!b) throw new Error("missing " + p);
      return b;
    },
    writeFile: async (p: string, d: Uint8Array) => void disk.set(p, d),
    writeFileChecked: async (p: string, expected: Uint8Array, d: Uint8Array) => {
      const current = disk.get(p);
      if (!current || String(current) !== String(expected)) return false;
      disk.set(p, d); return true;
    },
    saveDialog: async () => "D:\\q\\recovery.md",
    writeFileNew: async (p: string, d: Uint8Array) => { if (disk.has(p)) throw new Error("exists"); disk.set(p, d); },
    assetUrl: (a: string) => "asset://" + a,
    fileStat: async (p: string) => {
      const b = disk.get(p);
      if (!b) throw new Error("missing " + p);
      return { len: b.length, modified_ms: stamps.get(p) ?? 0 };
    },
    copyText: vi.fn(async () => {}),
    setWindowTitle: async () => {},
    confirm: vi.fn(async () => true),
    confirmDiscard: vi.fn(async () => true),
    confirmDanger: async () => false,
    notice: async () => {},
    alert: async () => {},
    onCloseRequested: async () => {},
    pathExists: async () => true,
    openExternal: async () => {},
    openWithDefaultApp: async () => {},
  },
}));
/** When set, diagrams take until it resolves (simulates slow rendering). */
let mermaidGate: Promise<void> | null = null;
const mermaidRoots: HTMLElement[] = [];
let themeChanged = () => {};
vi.mock("../src/md/mermaid", () => ({
  renderMermaid: async (root: HTMLElement) => {
    mermaidRoots.push(root);
    if (mermaidGate) await mermaidGate;
  },
  watchTheme: (cb: () => void) => { themeChanged = cb; },
}));
const editorFixture = {
  createEditor: async (host: HTMLElement, md: string) => {
    host.dataset.testEditor = md;
    return { getMarkdown: () => host.dataset.testEditor!, destroy: () => {} };
  },
};

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(path: string, text: string) {
  disk.set(path, enc(text));
  const { createViewer } = await import("../src/md/viewer");
  const viewer = createViewer(async () => editorFixture);
  const el = document.createElement("div");
  document.body.append(el);
  await viewer.mount(el, path);
  const toggle = el.querySelector<HTMLButtonElement>("button.md-mode-toggle")!;
  const article = el.querySelector("article")!;
  const editorHost = el.querySelector<HTMLElement>(".md-editor")!;
  return { el, toggle, article, editorHost };
}

beforeAll(async () => {
  // Preload the viewer and the (mocked) editor so the first test does not pay for module loading.
  await import("../src/md/viewer");
});

beforeEach(() => {
  gate = null;
  mermaidGate = null;
  mermaidRoots.length = 0;
  localStorage.clear();
  applyPreferences(DEFAULTS, false);
  vi.spyOn(window, "addEventListener");
});

afterEach(() => {
  const listener = vi.mocked(window.addEventListener);
  for (const [type, callback, options] of listener.mock.calls) {
    window.removeEventListener(type, callback, options);
  }
  listener.mockRestore();
  document.body.replaceChildren();
  disk.clear();
  stamps.clear();
});

test("an edit toggle during a focus re-read is queued, not dropped", async () => {
  const v = await mount("D:\\q\\a.md", "# one\n");
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  window.dispatchEvent(new Event("focus")); // starts the (slow) re-read
  await settle();
  v.toggle.click(); // arrives while the re-read is in flight
  await settle();
  expect(v.editorHost.hidden).toBe(true);
  release();
  // The queued toggle then lazy-loads the editor module: wait for the outcome, not a tick count.
  await vi.waitFor(() => {
    expect(v.editorHost.hidden).toBe(false);
    expect(v.toggle.textContent).toBe("읽기");
  });
});

test("leaving edit mode onto a file that became read-only keeps the read-only state", async () => {
  const path = "D:\\q\\c.md";
  const v = await mount(path, "# old\n");
  v.toggle.click();
  await settle();
  disk.set(path, enc("a\r\nb\nc\n")); // mixed line endings -> read-only
  v.toggle.click();
  await settle();
  expect(v.toggle.textContent).toBe("편집");
  expect(v.toggle.disabled).toBe(true);
  expect(v.toggle.title).toMatch(/^읽기 전용: /);
});

test("auto-repeated ctrl+e does not toggle", async () => {
  const v = await mount("D:\\q\\d.md", "# d\n");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true, repeat: true }));
  await settle();
  expect(v.editorHost.hidden).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true }));
  await settle();
  expect(v.editorHost.hidden).toBe(false);
});

test("leaving edit mode re-reads the file from disk before rendering", async () => {
  const path = "D:\\q\\b.md";
  const v = await mount(path, "# old\n");
  v.toggle.click();
  await settle();
  expect(v.toggle.textContent).toBe("읽기");
  v.editorHost.dataset.testEditor = "# edited but discarded\n"; // dirty -> confirm (mocked: discard)
  disk.set(path, enc("# changed by agent\n"));
  v.toggle.click();
  await settle();
  expect(v.toggle.textContent).toBe("편집");
  expect(v.article.textContent).toContain("changed by agent");
});

test("missing original is not recreated and edited markdown can be saved as a copy", async () => {
  const path = "D:\\q\\missing.md";
  disk.delete("D:\\q\\recovery.md");
  const v = await mount(path, "# old\n");
  v.toggle.click();
  await vi.waitFor(() => expect(v.toggle.textContent).toBe("읽기"));
  expect(v.editorHost.dataset.testEditor).toBe("# old\n");
  v.editorHost.dataset.testEditor = "# new\n";
  disk.delete(path);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
  await settle();
  expect(disk.has(path)).toBe(false);
  const copy = [...v.el.querySelectorAll("button")].find(b => b.textContent === "다른 이름으로 저장")!;
  copy.click(); await settle();
  expect(new TextDecoder().decode(disk.get("D:\\q\\recovery.md"))).toContain("new");
  expect(disk.has(path)).toBe(false);
});

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { ctrlKey: true, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};
const wheel = (target: Element, init: WheelEventInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  // happy-dom's WheelEvent lacks what a real one inherits from MouseEvent.
  Object.defineProperty(event, "ctrlKey", { value: !!init.ctrlKey });
  target.dispatchEvent(event);
  return event;
};
const openDialog = () => {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  return dialog;
};
const panelOf = (el: Element) => el.querySelector<HTMLElement>(".md-find")!;
function search(el: Element, query: string) {
  const input = panelOf(el).querySelector("input")!;
  input.value = query;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true })); // skips the debounce
}

test("the size shortcuts stop at the limit instead of falling back to the default", async () => {
  applyPreferences({ mdSize: 23 }, false);
  await mount("D:\\q\\s.md", "# s\n");
  expect(press({ key: "=", code: "Equal" }).defaultPrevented).toBe(true);
  expect(preferences().mdSize).toBe(24);
  press({ key: "=", code: "Equal" });
  expect(preferences().mdSize).toBe(24);
  press({ key: "0", code: "Digit0" });
  expect(preferences().mdSize).toBe(16);
  press({ key: "-", code: "Minus" });
  expect(preferences().mdSize).toBe(15);
  expect(document.documentElement.style.getPropertyValue("--va-md-size")).toBe("15px");
  expect(JSON.parse(localStorage.getItem("va.preferences.v1")!).mdSize).toBe(15);
});

test("ctrl+wheel changes the size and keeps the webview from zooming; a plain wheel only scrolls", async () => {
  const v = await mount("D:\\q\\w.md", "# w\n");
  const root = v.el.querySelector(".md-root")!;
  expect(wheel(root, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
  expect(preferences().mdSize).toBe(17);
  wheel(root, { deltaY: 100, ctrlKey: true });
  expect(preferences().mdSize).toBe(16);
  expect(wheel(root, { deltaY: -100 }).defaultPrevented).toBe(false);
  expect(preferences().mdSize).toBe(16);
});

test("the size follows in edit mode too, but leaves an open dialog alone", async () => {
  const v = await mount("D:\\q\\e.md", "# e\n");
  v.toggle.click();
  await vi.waitFor(() => expect(v.toggle.textContent).toBe("읽기"));
  press({ key: "=", code: "Equal" });
  expect(preferences().mdSize).toBe(17);
  openDialog();
  expect(press({ key: "=", code: "Equal" }).defaultPrevented).toBe(false);
  expect(preferences().mdSize).toBe(17);
});

test("ctrl+f searches the read view without changing its text; escape takes it all away", async () => {
  const v = await mount("D:\\q\\f.md", "one two **on**e\n");
  const before = v.article.textContent;
  expect(panelOf(v.el).hidden).toBe(true);
  expect(press({ key: "f" }).defaultPrevented).toBe(true);
  expect(panelOf(v.el).hidden).toBe(false);
  search(v.el, "one");
  expect(panelOf(v.el).querySelector(".md-find-count")!.textContent).toBe("1/2");
  expect(v.article.querySelectorAll("mark").length).toBe(3);
  expect(v.article.textContent).toBe(before);
  expect(press({ key: "Escape", ctrlKey: false }).defaultPrevented).toBe(true);
  expect(panelOf(v.el).hidden).toBe(true);
  expect(v.article.querySelector("mark")).toBeNull();
  expect(v.article.textContent).toBe(before);
});

test("the find keys stay out of an open dialog", async () => {
  const v = await mount("D:\\q\\g.md", "one\n");
  const dialog = openDialog();
  expect(press({ key: "f" }).defaultPrevented).toBe(false);
  expect(panelOf(v.el).hidden).toBe(true);
  dialog.remove();
  press({ key: "f" });
  openDialog();
  expect(press({ key: "Escape", ctrlKey: false }).defaultPrevented).toBe(false);
  expect(panelOf(v.el).hidden).toBe(false); // the dialog takes this escape
});

test("entering edit mode ends the search, and ctrl+f there stays with the editor", async () => {
  const v = await mount("D:\\q\\h.md", "one\n");
  press({ key: "f" });
  search(v.el, "one");
  expect(v.article.querySelector("mark")).not.toBeNull();
  v.toggle.click();
  await vi.waitFor(() => expect(v.toggle.textContent).toBe("읽기"));
  expect(panelOf(v.el).hidden).toBe(true);
  expect(v.article.querySelector("mark")).toBeNull();
  expect(press({ key: "f" }).defaultPrevented).toBe(false);
  expect(panelOf(v.el).hidden).toBe(true);
  expect(v.editorHost.dataset.testEditor).toBe("one\n"); // nothing of the marks reached the text
});

test("a reload redraws the search on the new content, keeping the position", async () => {
  const path = "D:\\q\\i.md";
  const v = await mount(path, "one one one\n");
  press({ key: "f" });
  search(v.el, "one");
  panelOf(v.el).querySelector<HTMLInputElement>("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(panelOf(v.el).querySelector(".md-find-count")!.textContent).toBe("2/3");
  disk.set(path, enc("one one one one\n"));
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(panelOf(v.el).querySelector(".md-find-count")!.textContent).toBe("2/4"));
  expect(v.article.querySelectorAll("mark").length).toBe(4);
  expect(v.article.querySelectorAll(".md-find-current").length).toBe(1);
});

test("code blocks get a copy button, also after a reload, and diagrams do not", async () => {
  const path = "D:\\q\\c2.md";
  const v = await mount(path, "```js\nconst a = 1;\n```\n\n```mermaid\ngraph\n```\n");
  expect(v.article.querySelectorAll(".md-code-copy").length).toBe(1);
  v.article.querySelector<HTMLButtonElement>(".md-code-copy")!.click();
  expect(platform.copyText).toHaveBeenLastCalledWith("const a = 1;");
  disk.set(path, enc("```\nnew\n```\n"));
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
  expect(v.article.querySelectorAll(".md-code-copy").length).toBe(1);
});

test("a reload keeps the old content on screen until the new one is finished", async () => {
  const path = "D:\\q\\j.md";
  const v = await mount(path, "# old\n");
  let release!: () => void;
  mermaidGate = new Promise<void>((r) => (release = r));
  disk.set(path, enc("# new\n"));
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(mermaidRoots.at(-1)).not.toBe(v.article);
  expect(v.article.textContent).toContain("old");
  release();
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
  expect(v.article.querySelector("#new")).not.toBeNull();
  expect(v.el.querySelector(".toc a")!.getAttribute("href")).toBe("#new");
});

test("a reload restores where the reader has scrolled to by then", async () => {
  const path = "D:\\q\\k.md";
  const v = await mount(path, "# old\n");
  v.el.scrollTop = 120;
  let release!: () => void;
  mermaidGate = new Promise<void>((r) => (release = r));
  disk.set(path, enc("# new\n"));
  window.dispatchEvent(new Event("focus"));
  await settle();
  v.el.scrollTop = 300;
  const scrollTo = vi.spyOn(v.el, "scrollTo");
  release();
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
  expect(scrollTo).toHaveBeenLastCalledWith(0, 300);
});

test("a reload keeps the details the reader opened, so the page height stays", async () => {
  const path = "D:\\q\\l.md";
  const v = await mount(path, "<details><summary>a</summary>x</details>\n\n<details><summary>b</summary>y</details>\n");
  v.article.querySelectorAll("details")[1].open = true;
  disk.set(path, enc("<details><summary>a</summary>x2</details>\n\n<details><summary>b</summary>y2</details>\n"));
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(v.article.textContent).toContain("y2"));
  expect([...v.article.querySelectorAll("details")].map((d) => d.open)).toEqual([false, true]);
});

test("a theme change during the preparation redraws the diagrams after the swap", async () => {
  const path = "D:\\q\\m.md";
  const v = await mount(path, "# old\n");
  let release!: () => void;
  mermaidGate = new Promise<void>((r) => (release = r));
  disk.set(path, enc("# new\n"));
  window.dispatchEvent(new Event("focus"));
  await settle();
  themeChanged();
  mermaidGate = null;
  mermaidRoots.length = 0;
  release();
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
  await vi.waitFor(() => expect(mermaidRoots).toContain(v.article));
});

test("an unchanged reload does not redraw the page", async () => {
  const path = "D:\\q\\n.md";
  const v = await mount(path, "# same\n");
  const heading = v.article.querySelector("h1");
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(v.article.querySelector("h1")).toBe(heading);
});

// The watch polls once a second: these run its rounds on a fake clock instead of waiting for them.
const withFakeClock = async (run: () => Promise<void>) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try { await run(); } finally { vi.useRealTimers(); }
};
const rounds = (n: number) => vi.advanceTimersByTimeAsync(n * 1200);
/** Writes like another program would: the time changes even when the length does not. */
const rewrite = (path: string, text: string) => {
  disk.set(path, enc(text));
  stamps.set(path, (stamps.get(path) ?? 0) + 1);
};

test("a change on disk shows without the window being activated", () => withFakeClock(async () => {
  const path = "D:\\q\\o.md";
  const v = await mount(path, "# old\n");
  await rounds(1);
  rewrite(path, "# new\n");
  await rounds(1);
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
}));

test("a selection holds the reload back until it is released", () => withFakeClock(async () => {
  const path = "D:\\q\\p.md";
  const v = await mount(path, "# old\n");
  await rounds(1);
  const selection = getSelection()!;
  selection.selectAllChildren(v.article);
  rewrite(path, "# new\n");
  await rounds(3);
  expect(v.article.textContent).toContain("old");
  selection.removeAllRanges();
  await rounds(1);
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
}));

test("edit mode is left alone, and what changed meanwhile shows when it ends", () => withFakeClock(async () => {
  const path = "D:\\q\\t.md";
  const v = await mount(path, "# old\n");
  await rounds(1);
  v.toggle.click();
  await vi.waitFor(() => expect(v.toggle.textContent).toBe("읽기"));
  rewrite(path, "# new\n");
  await rounds(3);
  expect(v.editorHost.dataset.testEditor).toBe("# old\n");
  expect(v.article.textContent).toContain("old");
  v.toggle.click();
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
}));

test("a file that could not be read when it changed is tried again", () => withFakeClock(async () => {
  const path = "D:\\q\\r.md";
  const v = await mount(path, "# old\n");
  await rounds(1);
  rewrite(path, "# new\n");
  const locked = Promise.reject(new Error("locked"));
  locked.catch(() => {});
  gate = locked;
  await rounds(1);
  expect(v.article.textContent).toContain("old");
  await rounds(1);
  await vi.waitFor(() => expect(v.article.textContent).toContain("new"));
}));

test("a deleted file keeps what is on screen", () => withFakeClock(async () => {
  const path = "D:\\q\\u.md";
  const v = await mount(path, "# old\n");
  await rounds(1);
  disk.delete(path);
  await rounds(2);
  expect(v.article.textContent).toContain("old");
}));

test("the watch ends with the view", () => withFakeClock(async () => {
  const path = "D:\\q\\v.md";
  await mount(path, "# old\n");
  const stat = vi.spyOn(platform, "fileStat");
  document.body.replaceChildren();
  await rounds(3);
  expect(stat).not.toHaveBeenCalled();
  stat.mockRestore();
}));
