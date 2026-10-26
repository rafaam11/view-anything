// Usage: node scripts/bump-version.mjs <X.Y.Z>
// Updates package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json and the
// `view-anything` entry of src-tauri/Cargo.lock. Edits text in place to keep formatting.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CARGO_VERSION_RE, readVersions } from "./check-version.mjs";

export { readVersions };

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const JSON_VERSION_RE = /^(\s*"version"\s*:\s*")([^"]+)(")/m;
const LOCK_ENTRY_RE = /(\[\[package\]\]\r?\nname = "view-anything"\r?\nversion = ")([^"]+)(")/;

function patch(file, re, version) {
  const text = readFileSync(file, "utf8");
  if (!re.test(text)) throw new Error(`version field not found in ${file}`);
  writeFileSync(file, text.replace(re, `$1${version}$3`));
}

export function bumpVersion(root, version) {
  if (!SEMVER_RE.test(version)) throw new Error(`invalid version "${version}", expected X.Y.Z`);
  patch(join(root, "package.json"), JSON_VERSION_RE, version);
  patch(join(root, "src-tauri", "Cargo.toml"), CARGO_VERSION_RE, version);
  patch(join(root, "src-tauri", "tauri.conf.json"), JSON_VERSION_RE, version);
  const lock = join(root, "src-tauri", "Cargo.lock");
  if (existsSync(lock)) patch(lock, LOCK_ENTRY_RE, version);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.VIEW_ANYTHING_ROOT || resolve(fileURLToPath(import.meta.url), "..", "..");
  try {
    const version = process.argv[2];
    if (!version) throw new Error("usage: node scripts/bump-version.mjs <X.Y.Z>");
    bumpVersion(root, version);
    console.log(`bumped to ${version}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
