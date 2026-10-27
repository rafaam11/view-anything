// Builds the exported-HTML viewer runtime: one self-contained IIFE (no chunks, no CSS file, no
// asset URLs) at build/runtime/va-runtime.js. The app's HTML exporter inlines it via `?raw`, so
// it must be built before the app (`npm run build:runtime`, run by `build` and `predev`).
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  // Library mode leaves process.env.NODE_ENV alone; the page has no `process`.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    outDir: "build/runtime",
    emptyOutDir: true,
    copyPublicDir: false,
    // Everything (wasm decoder, css) goes inline; nothing may be fetched from file://.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // Library IIFE output never code-splits: dynamic imports end up inline.
    lib: {
      entry: "src/three/export-runtime/main.ts",
      formats: ["iife"],
      name: "VaRuntime",
      fileName: () => "va-runtime.js",
    },
  },
});
