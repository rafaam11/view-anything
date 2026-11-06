// Usage: node scripts/ui-shots.mjs [outDir]
// Starts Vite on port 1430, screenshots /ui-gallery.html in both themes and every modal scene with
// headless Edge (or Chrome), then stops the server. Images go to outDir (default: an OS temp
// folder) and are never committed. Dev-only; nothing here is part of the app.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "va-ui-shots-")));
mkdirSync(out, { recursive: true });
const PORT = 1430;
const browsers = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = browsers.find((b) => existsSync(b));
// A profile of its own: otherwise a running browser may take the request and print nothing.
const profile = mkdtempSync(join(tmpdir(), "va-ui-shots-profile-"));
const capture = (args) => spawnSync(browser, ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, ...args], { timeout: 60000 });
if (!browser) throw new Error("no Edge or Chrome found for headless screenshots");

const shots = [];
for (const theme of ["light", "dark"]) {
  shots.push({ name: `${theme}-page`, query: `theme=${theme}`, height: 1100 });
  shots.push({ name: `${theme}-3d`, query: `theme=${theme}&view=3d`, height: 520 });
  shots.push({ name: `${theme}-menu`, query: `theme=${theme}&menu=open`, height: 700 });
  for (const scene of ["restart", "restart-dirty", "settings", "pdf-password", "dialog-discard", "dialog-error"]) {
    shots.push({ name: `${theme}-${scene}`, query: `theme=${theme}&scene=${scene}`, height: 800 });
  }
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
try {
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("vite did not start")), 30000);
    vite.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(timer); ok(); } });
    vite.on("exit", (code) => fail(new Error(`vite exited ${code}`)));
  });
  // Warm-up: Vite transforms and caches every module on the first load.
  capture(["--virtual-time-budget=10000", "--dump-dom", `http://localhost:${PORT}/ui-gallery.html`]);
  for (const shot of shots) {
    for (const scale of [1, 1.5]) {
      const file = join(out, `${shot.name}${scale === 1 ? "" : "@1.5x"}.png`);
      const r = capture([
        "--hide-scrollbars", `--force-device-scale-factor=${scale}`,
        `--window-size=1280,${shot.height}`, "--virtual-time-budget=8000", `--screenshot=${file}`,
        `http://localhost:${PORT}/ui-gallery.html?${shot.query}`,
      ]);
      if (r.status !== 0 || !existsSync(file)) throw new Error(`screenshot failed: ${shot.name} ${scale}x`);
    }
  }
  console.log(`${shots.length * 2} screenshots in ${out}`);
} finally {
  vite.kill();
}
