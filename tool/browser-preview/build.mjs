#!/usr/bin/env node
// Bundles tool/browser-preview/{server,shim}.ts into out/tool/ for
// `npm run preview:browser`. Mirrors the pattern electron.vite.config.ts's
// `buildNdiHostBundlePlugin` uses for a second, standalone entry point
// outside electron-vite's own main/preload/renderer builds: Vite's
// programmatic `build()` API in library mode. This has nothing to do with
// Electron — the server must run under plain Node, so `electron` stays
// external/unimported throughout.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'out', 'tool');

// The same workspace-package aliasing electron.vite.config.ts uses: every
// @lumacast/* package's package.json points "main" straight at its own
// src/index.ts (no build step of its own), so pointing the bundler there
// directly is correct and avoids requiring these packages to be pre-built.
const WORKSPACE_ALIAS = {
  '@lumacast/kernel': path.resolve(REPO_ROOT, 'packages/kernel/src/index.ts'),
  '@lumacast/composition': path.resolve(REPO_ROOT, 'packages/composition/src/index.ts'),
  '@lumacast/automation': path.resolve(REPO_ROOT, 'packages/automation/src/index.ts'),
  '@lumacast/commands': path.resolve(REPO_ROOT, 'packages/commands/src/index.ts'),
  '@lumacast/protocol': path.resolve(REPO_ROOT, 'packages/protocol/src/index.ts'),
  '@lumacast/persistence-sqlite': path.resolve(REPO_ROOT, 'packages/persistence-sqlite/src/index.ts'),
  '@lumacast/engine': path.resolve(REPO_ROOT, 'packages/engine/src/index.ts'),
};

async function buildServer() {
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      ssr: true,
      target: 'node22',
      sourcemap: true,
      lib: {
        // No "type": "module" anywhere above out/tool/, so a plain .js
        // extension is already CommonJS by Node's default resolution —
        // matching electron.vite.config.ts's buildNdiHostBundlePlugin, which
        // names its own CJS lib-mode output `ndi-host.js` the same way.
        entry: path.resolve(REPO_ROOT, 'tool/browser-preview/server.ts'),
        fileName: () => 'server.js',
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron', /^node:/, '@lumacast/ndi-native'],
      },
    },
    resolve: { alias: WORKSPACE_ALIAS },
  });
}

async function buildShim() {
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      target: 'es2020',
      sourcemap: true,
      lib: {
        entry: path.resolve(REPO_ROOT, 'tool/browser-preview/shim.ts'),
        fileName: () => 'browser-shim.js',
        formats: ['iife'],
        name: 'LumacastBrowserPreviewShim',
      },
    },
    resolve: { alias: WORKSPACE_ALIAS },
  });
}

await buildServer();
await buildShim();
console.log(`[browser-preview] bundled server + shim -> ${path.relative(REPO_ROOT, OUT_DIR)}/`);
