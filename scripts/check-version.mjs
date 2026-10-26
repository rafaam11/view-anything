// Usage: node scripts/check-version.mjs [tag]
// Exits 1 if package.json, Cargo.toml and tauri.conf.json versions differ,
// or if the given tag is not `v<version>`.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CARGO_VERSION_RE = /^(\[package\][^\[]*?^version\s*=\s*")([^"]+)(")/ms;

export function readVersions(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
  const cargoToml = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
  const m = CARGO_VERSION_RE.exec(cargoToml);
  if (!m) throw new Error("version not found in [package] of src-tauri/Cargo.toml");
  return { pkg, cargo: m[2], tauri };
}

/** Returns a list of problems; empty means OK. */
export function checkVersions({ pkg, cargo, tauri }, tag) {
  const problems = [];
  if (pkg !== cargo || pkg !== tauri) {
    problems.push(`version mismatch: package.json=${pkg} Cargo.toml=${cargo} tauri.conf.json=${tauri}`);
  }
  if (tag !== undefined && tag !== `v${pkg}`) {
    problems.push(`tag ${tag} does not match package.json v${pkg}`);
  }
  return problems;
}

export { CARGO_VERSION_RE };

function main() {
  const root = process.env.VIEW_ANYTHING_ROOT || resolve(fileURLToPath(import.meta.url), "..", "..");
  const tag = process.argv[2];
  const versions = readVersions(root);
  const problems = checkVersions(versions, tag);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`version ${versions.pkg} OK${tag ? ` (tag ${tag})` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
