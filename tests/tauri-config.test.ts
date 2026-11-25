// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings quote NSIS source, whose ${...} are NSIS defines
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { THREE_D_EXTENSIONS } from "../src/three/formats";
import { OFFICE_EXTENSIONS } from "../src/office/formats";
import { SCRIPT_EXTENSIONS } from "../src/text/formats";

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

const hook = readFileSync(new URL("../src-tauri/windows/file-associations.nsh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** The body of `!macro NAME …` up to its `!macroend`. */
const macro = (name: string) => {
  const start = hook.indexOf(`!macro ${name} `) >= 0 ? hook.indexOf(`!macro ${name} `) : hook.indexOf(`!macro ${name}\n`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return hook.slice(start, hook.indexOf("!macroend", start));
};
const listed = (name: string) => [...macro(name).matchAll(/!insertmacro \$\{MACRO\} "([a-z0-9]+)"/g)].map(m => m[1]);
const associated = conf.bundle.fileAssociations.flatMap((a: { ext: string[] }) => a.ext) as string[];

test("office files are one viewer class", () => {
  const office = conf.bundle.fileAssociations.find((a: { ext: string[] }) => a.ext.includes("docx"));
  expect([...office.ext].sort()).toEqual([...OFFICE_EXTENSIONS].sort());
  expect(office.role).toBe("Viewer");
});

test("nothing the shell runs is associated; scripts get only the right-click verb", () => {
  expect(listed("VA_EACH_SCRIPT")).toEqual(SCRIPT_EXTENSIONS);
  const executables = [...SCRIPT_EXTENSIONS, ...listed("VA_EACH_EXECUTABLE")];
  for (const ext of ["vbs", "wsf", "reg", "exe", "msi", "lnk"]) expect(executables).toContain(ext);
  expect(associated.filter(ext => executables.includes(ext))).toEqual([]);
  expect(macro("NSIS_HOOK_POSTINSTALL")).toContain("!insertmacro VA_EACH_SCRIPT VA_ADD_VERB");
  expect(macro("NSIS_HOOK_POSTINSTALL")).toContain("!insertmacro VA_EACH_EXECUTABLE VA_REPAIR_EXT");
  expect(macro("NSIS_HOOK_POSTUNINSTALL")).toContain("!insertmacro VA_EACH_SCRIPT VA_REMOVE_VERB");
  expect(macro("NSIS_HOOK_POSTUNINSTALL")).toContain("!insertmacro VA_EACH_EXECUTABLE VA_REPAIR_EXT");
  // The verb lives under SystemFileAssociations: no default, no Open With entry.
  expect(macro("VA_ADD_VERB")).not.toMatch(/OpenWithProgids|Classes\\.\$\{EXT\}"/);
});

test("the installer never takes a default: only the same-command migration writes one", () => {
  const associate = macro("APP_ASSOCIATE");
  const defaults = associate.split('WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" ').slice(1);
  expect(defaults).toHaveLength(1);
  const migration = associate.slice(associate.indexOf("${If} $R1 == `${COMMAND}`"), associate.indexOf("${EndIf}\n  ${EndIf}"));
  expect(migration).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" "${FILECLASS}"');
  expect(associate).toContain('"Software\\Classes\\.${EXT}\\OpenWithProgids" "${FILECLASS}"');
  expect(hook).not.toContain("viewanything.office\"");
});

test("uninstall restores only our defaults and clears our entries, Explorer's included", () => {
  const un = macro("APP_UNASSOCIATE");
  expect(un).toContain('${If} $R0 == "${FILECLASS}"');
  expect(un).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}" ""');
  expect(un).toContain('DeleteRegValue HKCU "${VA_FILEEXTS}\\.${EXT}\\OpenWithProgids" "${FILECLASS}"');
  // Repair: restore from a non-empty backup that is not ours, else drop the value.
  const repair = macro("VA_REPAIR_EXT");
  expect(repair).toContain('${AndIf} $R3 != "${VA_PREFIX}"');
  expect(repair).toContain('DeleteRegValue HKCU "Software\\Classes\\.${EXT}" ""');
  expect(macro("VA_CLEAR_ALL_FILES")).toContain('${If} $R1 == "${VA_PREFIX}"');
  expect("com.rafaam11.viewanything.").toHaveLength(26); // the StrCpy prefix length in the hook
  expect(hook.charCodeAt(0)).toBe(0xfeff); // NSIS reads the Korean verb name as UTF-8
});
