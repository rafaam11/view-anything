import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { EXECUTABLE_EXTENSIONS } from "../src/md/links";

const cap = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

/** `exe` -> `**\/*.[eE][xX][eE]` (the opener scope glob is case-sensitive). */
function denyGlob(ext: string): string {
  return "**/*." + [...ext].map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c)).join("");
}

test("opener open-path denies every executable extension the link classifier blocks", () => {
  const entry = cap.permissions.find((p: unknown) => typeof p === "object" && (p as { identifier: string }).identifier === "opener:allow-open-path");
  expect(entry).toBeDefined();
  expect(entry.allow).toEqual([{ path: "**" }]);
  const denied = new Set((entry.deny ?? []).map((d: { path: string }) => d.path));
  for (const ext of EXECUTABLE_EXTENSIONS) expect(denied.has(denyGlob(ext)), ext).toBe(true);
});
