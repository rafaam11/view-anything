import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolated, applicationFingerprint } from './common.mjs';
const root=isolated(),manifest=JSON.parse(fs.readFileSync(path.join(root,'application.json'),'utf8'));
assert.equal(manifest.platform,process.platform);assert.equal(manifest.fingerprint,applicationFingerprint(),'Packaged application inputs must exactly match this checkout');
for(const version of process.platform==='win32'?['0.0.1','0.0.2']:['0.0.2']){
  const config=JSON.parse(fs.readFileSync(path.join(root,`config-${version}.json`),'utf8'));
  assert.equal(config.identifier,'com.rafaam11.viewanything.desktop-smoke');assert.equal(config.version,version);
  assert(config.bundle.fileAssociations.every(a=>a.name.startsWith(config.identifier+'.')));
  assert(config.plugins.updater.endpoints.every(url=>url.startsWith('http://127.0.0.1:18761/')));
}
console.log('PASS packaged source fingerprint, platform and isolated fixture configuration');
