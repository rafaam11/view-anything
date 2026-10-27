// Usage: node scripts/make-latest-json.mjs <vX.Y.Z> <artifact directory>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function makeLatest(tag, files, notes, date = new Date().toISOString()) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("expected vX.Y.Z tag");
  const version = tag.slice(1);
  const platforms = {};
  for (const [platform, extension] of [["windows-x86_64", ".exe"], ["linux-x86_64", ".AppImage"]]) {
    const matches = files.filter((f) => f.name.endsWith(extension));
    if (matches.length !== 1) throw new Error(`expected one ${extension}, got ${matches.length}`);
    const asset = matches[0];
    if (!asset.name.includes(version)) throw new Error(`wrong version: ${asset.name}`);
    const signatures = files.filter((f) => f.name === asset.name + ".sig");
    if (signatures.length !== 1 || !signatures[0].text?.trim()) throw new Error(`missing or duplicate signature: ${asset.name}`);
    platforms[platform] = {
      url: `https://github.com/rafaam11/view-anything/releases/download/${tag}/${encodeURIComponent(asset.name)}`,
      signature: signatures[0].text.trim(),
    };
  }
  const summary = notes.replace(/^#.*\r?\n/, "").trim().split(/\r?\n\s*\r?\n/)[0];
  if (!summary) throw new Error("missing release summary");
  return { version, notes: summary, pub_date: date, platforms };
}

function scan(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? scan(path) : [{ name: basename(path), text: path.endsWith(".sig") ? readFileSync(path, "utf8") : undefined }];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, dir] = process.argv.slice(2);
  if (!tag || !dir) throw new Error("usage: make-latest-json.mjs vX.Y.Z artifact-directory");
  const result = makeLatest(tag, scan(dir), readFileSync(`docs/release/${tag}.md`, "utf8"));
  writeFileSync(join(dir, "latest.json"), JSON.stringify(result, null, 2) + "\n");
}
