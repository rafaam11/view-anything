import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolated, repo, run } from './common.mjs';
const root = isolated(), cli = path.join(repo, 'node_modules/@tauri-apps/cli/tauri.js');
const windows = process.platform === 'win32', config = JSON.parse(fs.readFileSync(path.join(repo, 'src-tauri/tauri.conf.json'), 'utf8'));
const base = {
  productName: 'view-anything-desktop-smoke', identifier: 'com.rafaam11.viewanything.desktop-smoke',
  bundle: { createUpdaterArtifacts: windows, fileAssociations: config.bundle.fileAssociations.map((a,i) => ({ ...a, name: `com.rafaam11.viewanything.desktop-smoke.type${i}` })) },
};
const env = { ...process.env };
if (windows) {
  const key = path.join(root, 'ephemeral-updater.key');
  run(process.execPath, [cli, 'signer', 'generate', '--ci', '-p', 'desktop-test-only', '-w', key], { stdio: 'pipe' });
  env.TAURI_SIGNING_PRIVATE_KEY = key; env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 'desktop-test-only';
  base.plugins = { updater: { pubkey: fs.readFileSync(key + '.pub', 'utf8').trim(), endpoints: ['http://127.0.0.1:18761/latest.json'], dangerousInsecureTransportProtocol: true, windows: { installMode: 'quiet' } } };
}
for (const version of windows ? ['0.0.1','0.0.2'] : ['0.0.2']) {
  const file = path.join(root, `config-${version}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...base, version }, null, 2));
  run(process.execPath, [cli, 'build', '--bundles', windows ? 'nsis' : 'deb,appimage', '--config', file], { env });
  const output = path.join(root, 'packages', version); fs.mkdirSync(output, { recursive: true });
  if (windows) fs.writeFileSync(path.join(output,'binary.sha256'),createHash('sha256').update(fs.readFileSync(path.join(repo,'src-tauri/target/release/view-anything.exe'))).digest('hex'));
  for (const format of windows ? ['nsis'] : ['deb','appimage']) {
    const built = path.join(repo, 'src-tauri/target/release/bundle', format);
    for (const name of fs.readdirSync(built)) if (name.includes(`_${version}_`)) fs.copyFileSync(path.join(built,name), path.join(output,name));
  }
}
