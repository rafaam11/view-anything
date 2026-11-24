import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { THREE_D_EXTENSIONS } from "../src/three/formats";
import { OFFICE_EXTENSIONS } from "../src/office/formats";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const sec = conf.app.security;

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

for (const key of ["csp", "devCsp"] as const) {
  test(`${key} allows wasm, asset streaming and module workers only as needed`, () => {
    const csp = sec[key];
    expect(csp["default-src"]).toBe("'self'");
    expect(tokens(csp["script-src"]).sort()).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(tokens(csp["worker-src"]).sort()).toEqual(["'self'", "blob:"]);
    const connect = tokens(csp["connect-src"]);
    for (const t of ["ipc:", "http://ipc.localhost", "asset:", "http://asset.localhost"]) expect(connect).toContain(t);
    expect(connect).not.toContain("*");
    expect(connect).not.toContain("https:");
    expect(csp["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(csp["img-src"]).toBe("'self' asset: http://asset.localhost https: data: blob:");
    expect(csp["font-src"]).toBe("'self' data:");
  });
}

test("devCsp keeps the dev server websocket", () => {
  const connect = tokens(sec.devCsp["connect-src"]);
  expect(connect).toContain("ws://localhost:1420");
  expect(connect).toContain("ws://localhost:1421");
});

test("3D extensions are registered as a file association", () => {
  const assoc = conf.bundle.fileAssociations.find((a: { ext: string[] }) => a.ext.includes("pcd"));
  expect(assoc).toBeDefined();
  expect(assoc.role).toBe("Viewer");
  expect([...assoc.ext].sort()).toEqual([...THREE_D_EXTENSIONS].sort());
  const md = conf.bundle.fileAssociations.find((a: { ext: string[] }) => a.ext.includes("md"));
  expect(md.ext).toEqual(["md", "markdown"]);
});
test("file association classes are unique to the app and have human descriptions",()=>{
  const names = conf.bundle.fileAssociations.map((a:{name:string;description:string})=>{
    expect(a.name.startsWith(conf.identifier+".")).toBe(true);expect(a.description.length).toBeGreaterThan(0);return a.name;
  });
  expect(new Set(names).size).toBe(names.length);
});

test("office files are associated as one viewer class that the installer only offers under Open With", () => {
  const office = conf.bundle.fileAssociations.find((a: { ext: string[] }) => a.ext.includes("docx"));
  expect([...office.ext].sort()).toEqual([...OFFICE_EXTENSIONS].sort());
  expect(office.role).toBe("Viewer");
  const hook = readFileSync(new URL("../src-tauri/windows/file-associations.nsh", import.meta.url), "utf8");
  // The default-taking block is compiled out for exactly this class; Open With stays for every class.
  expect(hook).toContain(`!if "\${FILECLASS}" != "${office.name}"`);
  const guarded = hook.slice(hook.indexOf("!if"), hook.indexOf("!endif"));
  const nsis = (name: string) => `$${"{"}${name}}`;
  expect(guarded).toContain(String.raw`WriteRegStr SHELL_CONTEXT "Software\Classes\.` + `${nsis("EXT")}" "" "${nsis("FILECLASS")}"`);
  expect(guarded).not.toContain("OpenWithProgids");
});
