// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { checkManifest, checkRuntime } from "../scripts/check-bundle.mjs";

/** Shape of a Vite 8 (rolldown) `dist/.vite/manifest.json`. */
function manifest(extra: Record<string, unknown> = {}, entryImports: string[] = ["_preload-helper.js"], mdImports: string[] = ["_preload-helper.js"]) {
  return {
    "index.html": {
      file: "assets/index-AAA.js",
      name: "index",
      src: "index.html",
      isEntry: true,
      imports: entryImports,
      dynamicImports: ["src/md/viewer.ts", "src/three/viewer.ts"],
      css: ["assets/index-AAA.css"],
    },
    "_preload-helper.js": { file: "assets/preload-helper-BBB.js", name: "preload-helper" },
    "src/md/viewer.ts": {
      file: "assets/viewer-CCC.js",
      name: "viewer",
      src: "src/md/viewer.ts",
      isDynamicEntry: true,
      imports: mdImports,
      dynamicImports: ["node_modules/mermaid/dist/mermaid.core.mjs"],
    },
    "node_modules/mermaid/dist/mermaid.core.mjs": {
      file: "assets/mermaid.core-DDD.js",
      src: "node_modules/mermaid/dist/mermaid.core.mjs",
      isDynamicEntry: true,
    },
    "src/three/viewer.ts": {
      file: "assets/viewer-EEE.js",
      name: "viewer",
      src: "src/three/viewer.ts",
      isDynamicEntry: true,
      imports: ["_three.module-FFF.js", "_preload-helper.js"],
      dynamicImports: ["node_modules/occt-import-js/dist/occt-import-js.js"],
    },
    "_three.module-FFF.js": { file: "assets/three.module-FFF.js", name: "three.module" },
    "node_modules/occt-import-js/dist/occt-import-js.js": {
      file: "assets/occt-import-js-GGG.js",
      src: "node_modules/occt-import-js/dist/occt-import-js.js",
      isDynamicEntry: true,
    },
    ...extra,
  };
}

test("passes when three and occt are only reachable through dynamic imports", () => {
  expect(checkManifest(manifest())).toEqual([]);
});

test("fails when the entry statically imports a three chunk", () => {
  const problems = checkManifest(manifest({}, ["_preload-helper.js", "_three.module-FFF.js"]));
  expect(problems.join("\n")).toMatch(/three\.module/);
});

test("fails when the md viewer reaches occt through a shared chunk", () => {
  const m = manifest(
    { "_shared-HHH.js": { file: "assets/shared-HHH.js", imports: ["node_modules/occt-import-js/dist/occt-import-js.js"] } },
    undefined,
    ["_preload-helper.js", "_shared-HHH.js"],
  );
  const problems = checkManifest(m);
  expect(problems.join("\n")).toMatch(/occt/);
  expect(problems.join("\n")).toMatch(/src\/md\/viewer\.ts/);
});

test("fails when the entry or md chunk is missing", () => {
  const m = manifest() as Record<string, unknown>;
  delete m["src/md/viewer.ts"];
  expect(checkManifest(m).join("\n")).toMatch(/md viewer/);
  const n = manifest() as Record<string, { isEntry?: boolean }>;
  delete n["index.html"].isEntry;
  expect(checkManifest(n).join("\n")).toMatch(/entry/);
});

test("rejects statically inlined updater and process plugin commands", () => {
  for (const code of ['invoke("plugin:updater|check")', 'invoke("plugin:process|restart")']) {
    expect(checkManifest(manifest(), () => code).length).toBeGreaterThan(0);
  }
});

test("fails when three is inlined into the entry chunk itself", () => {
  const code: Record<string, string> = { "assets/index-AAA.js": 'const R="186";window.__THREE__=R;' };
  const read = (f: string) => code[f] ?? "export{}";
  expect(checkManifest(manifest())).toEqual([]);
  expect(checkManifest(manifest(), read).join("\n")).toMatch(/index\.html.*__THREE__/);
});

test("fails when occt is inlined into a shared chunk of the md viewer", () => {
  const m = manifest({ "_lib-HHH.js": { file: "assets/lib-HHH.js" } }, undefined, ["_lib-HHH.js"]);
  const read = (f: string) => (f === "assets/lib-HHH.js" ? 'var f="occt-import-js.wasm";' : "export{}");
  expect(checkManifest(m, read).join("\n")).toMatch(/src\/md\/viewer\.ts.*occt-import-js\.wasm/);
});

test("code of dynamically imported chunks is not scanned", () => {
  const read = (f: string) => (f.startsWith("assets/three") || f.startsWith("assets/viewer-EEE") ? "window.__THREE__=1" : "export{}");
  expect(checkManifest(manifest(), read)).toEqual([]);
});

test("a reached chunk file that is missing is reported", () => {
  expect(checkManifest(manifest(), () => null).join("\n")).toMatch(/missing/);
});

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function runCli(m: Record<string, { file: string }>, code: Record<string, string> = {}, runtime: string | null = "(function(){})();") {
  const root = mkdtempSync(join(tmpdir(), "va-bundle-"));
  dirs.push(root);
  if (runtime !== null) {
    mkdirSync(join(root, "build", "runtime"), { recursive: true });
    writeFileSync(join(root, "build", "runtime", "va-runtime.js"), runtime);
  }
  mkdirSync(join(root, "dist", ".vite"), { recursive: true });
  mkdirSync(join(root, "dist", "assets"), { recursive: true });
  writeFileSync(join(root, "dist", ".vite", "manifest.json"), JSON.stringify(m));
  for (const c of Object.values(m)) writeFileSync(join(root, "dist", c.file), code[c.file] ?? "export{}");
  return spawnSync(process.execPath, [resolve(__dirname, "..", "scripts", "check-bundle.mjs")], {
    env: { ...process.env, VIEW_ANYTHING_ROOT: root },
    encoding: "utf8",
  });
}

test("cli exits 0 for a clean manifest and 1 for a polluted one", () => {
  expect(runCli(manifest()).status).toBe(0);
  const bad = runCli(manifest({}, ["_three.module-FFF.js"]));
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/three/);
  const inlined = runCli(manifest(), { "assets/index-AAA.js": "window.__THREE__=1" });
  expect(inlined.status).toBe(1);
  expect(inlined.stderr).toMatch(/__THREE__/);
});

test("cli exits 1 when the manifest is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "va-bundle-"));
  dirs.push(root);
  const r = spawnSync(process.execPath, [resolve(__dirname, "..", "scripts", "check-bundle.mjs")], {
    env: { ...process.env, VIEW_ANYTHING_ROOT: root },
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
});

test("exported-HTML runtime: Tauri markers and module syntax are reported", () => {
  expect(checkRuntime("(function(){var a=1;})();")).toEqual([]);
  expect(checkRuntime('(function(){require("@tauri-apps/api")})();').join(" ")).toMatch(/Tauri/);
  expect(checkRuntime("(function(){window.__TAURI_INTERNALS__})();").join(" ")).toMatch(/Tauri/);
  expect(checkRuntime("import x from 'y';").join(" ")).toMatch(/module/);
  expect(checkRuntime("(function(){import.meta.url})();").join(" ")).toMatch(/module/);
});

test("cli fails when the runtime bundle is missing or uses Tauri", () => {
  const missing = runCli(manifest(), {}, null);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/va-runtime.js/);
  const tauri = runCli(manifest(), {}, "(function(){window.__TAURI__})();");
  expect(tauri.status).toBe(1);
  expect(tauri.stderr).toMatch(/Tauri/);
});
