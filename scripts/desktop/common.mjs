import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const repo = path.resolve(import.meta.dirname, '../..');
export function isolated() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Installation tests require a disposable GitHub-hosted runner');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted/user machines must not run installation tests');
  const root = path.resolve(process.env.VA_DESKTOP_ROOT ?? path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'va-desktop'));
  const temp = path.resolve(process.env.RUNNER_TEMP);
  assert(root.startsWith(temp + path.sep) && path.basename(root).startsWith('va-desktop'), 'Test files must stay in RUNNER_TEMP/va-desktop*');
  fs.mkdirSync(root, { recursive: true });
  return root;
}
export function run(exe, args, options = {}) {
  return execFileSync(exe, args, { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: 'inherit', ...options });
}
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, label, timeout = 60000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(200); }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}
export function fixtures(root) {
  const dir = path.join(root, 'files with spaces'); fs.mkdirSync(dir, { recursive: true });
  const files = { txt: path.join(dir, '한글 text.txt'), png: path.join(dir, 'sample image.png'), pdf: path.join(dir, 'sample.pdf'), pcd: path.join(dir, 'grid.pcd'), stl: path.join(dir, 'cube.stl') };
  fs.writeFileSync(files.txt, '\ufeff원문 보존\r\nsecond line\r\n');
  fs.copyFileSync(path.join(repo, 'tests/fixtures/그림 1.png'), files.png);
  fs.copyFileSync(path.join(repo, 'tests/fixtures/3d/grid.pcd'), files.pcd);
  fs.copyFileSync(path.join(repo, 'tests/fixtures/3d/cube-ascii.stl'), files.stl);
  const stream = 'BT /F1 18 Tf 40 100 Td (needle desktop test) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  fs.writeFileSync(files.pdf, pdf); return files;
}
