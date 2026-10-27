// @vitest-environment happy-dom
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

const disk = new Map<string, Uint8Array>();
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
    assetUrl: (a: string) => "asset://" + a,
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
vi.mock("../src/md/mermaid", () => ({ renderMermaid: async () => {}, watchTheme: () => {} }));
let editorText = "";
vi.mock("../src/md/editor", () => ({
  createEditor: async (_host: HTMLElement, md: string) => {
    editorText = md;
    return { getMarkdown: () => editorText, destroy: () => {} };
  },
}));

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(path: string, text: string) {
  disk.set(path, enc(text));
  const { default: viewer } = await import("../src/md/viewer");
  const el = document.createElement("div");
  document.body.append(el);
  await viewer.mount(el, path);
  const toggle = el.querySelector<HTMLButtonElement>("button.md-toggle")!;
  const article = el.querySelector("article")!;
  const editorHost = el.querySelector<HTMLElement>(".md-editor")!;
  return { el, toggle, article, editorHost };
}

beforeAll(async () => {
  // Preload the viewer and the (mocked) editor so the first test does not pay for module loading.
  await Promise.all([import("../src/md/viewer"), import("../src/md/editor")]);
});

beforeEach(() => {
  gate = null;
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
  editorText = "# edited but discarded\n"; // dirty -> confirm (mocked: discard)
  disk.set(path, enc("# changed by agent\n"));
  v.toggle.click();
  await settle();
  expect(v.toggle.textContent).toBe("편집");
  expect(v.article.textContent).toContain("changed by agent");
});
