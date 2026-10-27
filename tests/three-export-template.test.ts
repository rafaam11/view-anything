// HTML export: single-file template (escaping, CSP), base64 codec, the 50 MB warning and the state
// JSON schema.
import { expect, test } from "vitest";
import { defaultHtmlPath, EXPORT_CSP, escapeScript, jsonForScript, renderHtml } from "../src/three/export/template";
import { fromBase64, toBase64 } from "../src/three/export/codec";
import { exceedsSizeWarning, SIZE_WARN_BYTES } from "../src/three/export/size";
import { parseState, STATE_VERSION, type ExportState } from "../src/three/export/state";

function sampleState(name = "a.stl"): ExportState {
  return {
    version: STATE_VERSION,
    title: name,
    display: "zup-rh",
    unit: "mm",
    mode: "edges",
    sections: [
      { enabled: false, value: null },
      { enabled: true, value: 1.5 },
      { enabled: false, value: -2 },
    ],
    camera: { position: [1, 2, 3], target: [0, 0, 0] },
    panelCollapsed: false,
    files: [
      {
        id: "f1",
        name,
        format: "stl",
        sourceUnit: "as-is",
        tree: { id: "f1", name, kind: "file", visible: true, children: [{ id: "f1/0", name: "Part 1", kind: "part", visible: true, children: [] }] },
      },
    ],
  };
}

test("base64 round trip, including sizes that are not multiples of 3 and > one chunk", () => {
  for (const n of [0, 1, 2, 3, 4, 100, 65_537, 300_001]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const text = toBase64(bytes);
    expect(text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(text.length).toBe(Math.ceil(n / 3) * 4);
    expect(fromBase64(text)).toEqual(bytes);
  }
  expect(toBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  // Whitespace (line breaks in a hand-edited file) is ignored.
  expect(new TextDecoder().decode(fromBase64("aGVs\nbG8="))).toBe("hello");
});

test("50 MB warning boundary", () => {
  expect(SIZE_WARN_BYTES).toBe(50 * 1024 * 1024);
  expect(exceedsSizeWarning(SIZE_WARN_BYTES)).toBe(false);
  expect(exceedsSizeWarning(SIZE_WARN_BYTES + 1)).toBe(true);
  expect(exceedsSizeWarning(0)).toBe(false);
});

test("script text cannot close its <script> element or open a comment", () => {
  const js = 'var s = "</script><script>alert(1)</script>"; var t = "</SCRIPT >"; var c = "<!-- x";';
  const out = escapeScript(js);
  expect(out).not.toMatch(/<\/script/i);
  expect(out).not.toContain("<!--");
  // Still the same JavaScript.
  expect(new Function(`${out}; return [s, t, c];`)()).toEqual(["</script><script>alert(1)</script>", "</SCRIPT >", "<!-- x"]);
});

test("JSON for a script element escapes < > & and the JS line separators, and parses back", () => {
  const separators = String.fromCharCode(0x2028, 0x2029);
  const value = { name: `</script><img src=x onerror=alert(1)> & ${separators} <!--` };
  const text = jsonForScript(value);
  expect(text).not.toMatch(new RegExp(`[<>&${separators}]`));
  expect(JSON.parse(text)).toEqual(value);
});

test("renderHtml: one offline file with CSP, the GLB, the state and the runtime; hostile part names stay inert", () => {
  const evil = '</script><script>alert("x")</script><!--';
  const state = sampleState(evil);
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const runtime = 'console.log("</script>");';
  const html = renderHtml({ title: evil, glb, state, runtime });
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`);
  expect(EXPORT_CSP).toBe("default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:");
  // Exactly the three script elements we wrote, each closed once.
  expect(html.match(/<script\b/gi)).toHaveLength(3);
  expect(html.match(/<\/script/gi)).toHaveLength(3);
  expect(html).not.toContain("<!--");
  expect(html).not.toMatch(/https?:\/\//);
  // Title is HTML-escaped.
  expect(html).toContain("<title>&lt;/script&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;!--</title>");

  // The embedded parts come back intact (what the runtime reads).
  const doc = new DOMParserLike(html);
  expect(fromBase64(doc.script("va-glb", "application/octet-stream"))).toEqual(glb);
  const parsed = parseState(JSON.parse(doc.script("va-state", "application/json")));
  expect(parsed.files[0].tree.name).toBe(evil);
  expect(parsed).toEqual(state);
});

/** Minimal extraction of `<script type=... id=...>` bodies (no DOM needed). */
class DOMParserLike {
  constructor(private readonly html: string) {}
  script(id: string, type: string): string {
    const re = new RegExp(`<script type="${type}" id="${id}">([\\s\\S]*?)</script>`);
    const m = re.exec(this.html);
    if (!m) throw new Error(`script #${id} not found`);
    return m[1];
  }
}

test("state schema: a valid state parses; wrong versions and shapes are rejected", () => {
  const ok = sampleState();
  expect(parseState(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
  const bad = (patch: (s: Record<string, unknown>) => void) => {
    const s = JSON.parse(JSON.stringify(ok));
    patch(s);
    return () => parseState(s);
  };
  expect(bad((s) => (s.version = 99))).toThrow(/version/);
  expect(bad((s) => (s.display = "nope"))).toThrow(/display/);
  expect(bad((s) => (s.unit = "ft"))).toThrow(/unit/);
  expect(bad((s) => (s.mode = "toon"))).toThrow(/mode/);
  expect(bad((s) => (s.sections = []))).toThrow(/sections/);
  expect(bad((s) => ((s.camera as { position: unknown }).position = [1, 2]))).toThrow(/camera/);
  expect(bad((s) => ((s.files as { tree: { name: unknown } }[])[0].tree.name = 5))).toThrow(/name/);
  expect(bad((s) => ((s.files as { tree: { kind: unknown } }[])[0].tree.kind = "x"))).toThrow(/kind/);
  expect(bad((s) => ((s.files as { sourceUnit: unknown }[])[0].sourceUnit = "yd"))).toThrow(/sourceUnit/);
  expect(() => parseState(null)).toThrow();
});

test("save dialog default: first file's folder and stem with .html", () => {
  expect(defaultHtmlPath("D:/m/a.step")).toBe("D:/m/a.html");
  expect(defaultHtmlPath("D:/m/v1.2/part.final.stl")).toBe("D:/m/v1.2/part.final.html");
  expect(defaultHtmlPath("noext")).toBe("noext.html");
  expect(defaultHtmlPath(".hidden")).toBe(".hidden.html");
});
