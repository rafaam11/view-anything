// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { readVersions, checkVersions } from "../scripts/check-version.mjs";
// @ts-expect-error plain .mjs script without type declarations
import { bumpVersion } from "../scripts/bump-version.mjs";

const SCRIPTS = resolve(__dirname, "..", "scripts");
const dirs: string[] = [];

function fixture(pkg: string, cargo: string, tauri: string): string {
  const root = mkdtempSync(join(tmpdir(), "va-version-"));
  dirs.push(root);
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "view-anything", version: pkg }, null, 2) + "\n");
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "view-anything"\nversion = "${cargo}"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n`,
  );
  writeFileSync(join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ productName: "view-anything", version: tauri }, null, 2) + "\n");
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "view-anything"\nversion = "${cargo}"\ndependencies = [\n "serde",\n]\n`,
  );
  return root;
}

function run(script: string, root: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    env: { ...process.env, VIEW_ANYTHING_ROOT: root },
    encoding: "utf8",
  });
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("version tooling", () => {
  test("readVersions reads all three files", () => {
    const root = fixture("0.1.0", "0.1.0", "0.1.0");
    expect(readVersions(root)).toEqual({ pkg: "0.1.0", cargo: "0.1.0", tauri: "0.1.0" });
  });

  test("check passes when versions match", () => {
    const root = fixture("0.1.0", "0.1.0", "0.1.0");
    expect(checkVersions(readVersions(root))).toEqual([]);
    expect(run("check-version.mjs", root).status).toBe(0);
    expect(run("check-version.mjs", root, ["v0.1.0"]).status).toBe(0);
  });

  test("check fails when versions differ", () => {
    const root = fixture("0.1.0", "0.1.1", "0.1.0");
    expect(checkVersions(readVersions(root)).length).toBeGreaterThan(0);
    expect(run("check-version.mjs", root).status).toBe(1);
  });

  test("check fails when tag mismatches", () => {
    const root = fixture("0.1.0", "0.1.0", "0.1.0");
    expect(checkVersions(readVersions(root), "v0.2.0").length).toBeGreaterThan(0);
    expect(run("check-version.mjs", root, ["v0.2.0"]).status).toBe(1);
  });

  test("bump updates all three and the lockfile entry only", () => {
    const root = fixture("0.1.0", "0.1.0", "0.1.0");
    bumpVersion(root, "0.2.0");
    expect(readVersions(root)).toEqual({ pkg: "0.2.0", cargo: "0.2.0", tauri: "0.2.0" });
    const lock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
    expect(lock).toContain('name = "view-anything"\nversion = "0.2.0"');
    expect(lock).toContain('name = "serde"\nversion = "1.0.0"');
    const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    expect(cargo).toContain('serde = { version = "1"');
  });

  test("bump CLI rejects non-semver and succeeds on valid", () => {
    const root = fixture("0.1.0", "0.1.0", "0.1.0");
    expect(run("bump-version.mjs", root, ["abc"]).status).toBe(1);
    expect(run("bump-version.mjs", root, []).status).toBe(1);
    expect(run("bump-version.mjs", root, ["0.3.0"]).status).toBe(0);
    expect(run("check-version.mjs", root, ["v0.3.0"]).status).toBe(0);
  });
});
