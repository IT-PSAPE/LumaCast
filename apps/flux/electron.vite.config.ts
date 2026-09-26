import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build as viteBuild, type Plugin } from 'vite';

// Every path in this config is app-local: sources live in apps/flux, builds land
// in apps/flux/out, and installers in apps/flux/dist, so the Flux build never
// shares state with apps/cast or apps/cloud. The config runs with apps/flux as
// the working directory (via the root workspace scripts), so relative outDirs
// stay inside the app.

// Workspace packages whose package.json "main" points straight at
// src/index.ts (raw ESM TypeScript, no build step of their own). Externalizing
// them would emit require("@lumacast/<name>") in the bundled output, and
// Node's CJS loader cannot parse that raw source — so they stay bundled via the
// alias below instead.
const BUNDLED_WORKSPACE_PACKAGES = [
  '@lumacast/ui',
  '@lumacast/photo-model',
  '@lumacast/photo-imaging',
  '@lumacast/photo-library',
] as const;

function workspaceAlias(): Record<string, string> {
  return Object.fromEntries(
    BUNDLED_WORKSPACE_PACKAGES.map((name) => [
      name,
      path.resolve(__dirname, '../../packages', name.replace('@lumacast/', ''), 'src/index.ts'),
    ]),
  );
}

// The main bundle cannot express three extra outputs, so they are built
// explicitly after it:
//
//  1. out/main/imaging/render-worker.js — the worker thread RenderPool starts.
//     It is a separate module file because a worker is `new Worker(path)`, not
//     an import from the main bundle. Its native dependencies (sharp/libvips and
//     the LibRaw WASM decoder) stay external, because a native addon cannot be
//     bundled into a worker file; the packaged app ships them as real files in
//     node_modules and the worker requires them at runtime.
//  2. out/main/imaging/raw-decoder.mjs — copied verbatim. It is a
//     `new Worker()` target too, and it is deliberately *not* bundled: the
//     libraw-wasm loader resolves its own .wasm file at runtime, so the module
//     must keep its real on-disk location next to the worker that starts it.
//  3. out/mcp/stdio.mjs — the standalone stdio bridge an external MCP client
//     spawns with `node`. It is bundled to a single ESM file (including the
//     MCP SDK) because a packaged build copies only this one file into
//     resources/, where nothing would be able to resolve a bare specifier, and
//     because it must never pull in a repository workspace path.
function extraMainOutputsPlugin(): Plugin {
  let inProgress = false;
  return {
    name: 'lumaflux-extra-main-outputs',
    enforce: 'post',
    async closeBundle() {
      if (inProgress) return;
      inProgress = true;
      try {
        await viteBuild({
          configFile: false,
          logLevel: 'warn',
          // sharp (libvips) and the LibRaw WASM decoder are loaded as native and
          // binary payloads from node_modules at runtime, so they must stay
          // external here; the workspace imaging package is bundled (see the
          // alias) because its source is raw TypeScript Node cannot require.
          // `ssr.external` only accepts strings, so the @img/* subpath pattern
          // lives in rollupOptions.external below, which does take a RegExp.
          ssr: { external: ['sharp', 'libraw-wasm'] },
          build: {
            outDir: path.resolve(__dirname, 'out/main'),
            emptyOutDir: false,
            ssr: true,
            target: 'node22',
            sourcemap: true,
            lib: {
              entry: path.resolve(__dirname, 'main/imaging/render-worker.ts'),
              formats: ['cjs'],
            },
            rollupOptions: {
              external: ['electron', /^node:/, 'sharp', /^@img\//, 'libraw-wasm'],
              output: {
                // An SSR lib build names its chunk from entryFileNames, not from
                // lib.fileName, so the imaging/ subdirectory has to be requested
                // here: the worker must land beside raw-decoder.mjs, where
                // resolveImagingResources expects it.
                entryFileNames: 'imaging/render-worker.js',
              },
            },
          },
          resolve: { alias: workspaceAlias() },
        });

        await viteBuild({
          configFile: false,
          logLevel: 'warn',
          // A single self-contained file: nothing in resources/ can resolve a
          // bare specifier, so every dependency — the MCP SDK included — must
          // be inlined. Node builtins stay external and are resolved by Node.
          ssr: { noExternal: true },
          build: {
            outDir: path.resolve(__dirname, 'out/mcp'),
            emptyOutDir: false,
            ssr: true,
            target: 'node22',
            minify: false,
            lib: {
              entry: path.resolve(__dirname, 'main/mcp/stdio.ts'),
              fileName: () => 'stdio.mjs',
              formats: ['es'],
            },
            rollupOptions: {
              external: [/^node:/],
              output: {
                banner:
                  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
              },
            },
          },
        });

        await mkdir(path.resolve(__dirname, 'out/main/imaging'), { recursive: true });
        await copyFile(
          path.resolve(__dirname, 'main/imaging/raw-decoder.mjs'),
          path.resolve(__dirname, 'out/main/imaging/raw-decoder.mjs'),
        );
      } finally {
        inProgress = false;
      }
    },
  };
}

function rendererManualChunks(id: string): string | undefined {
  const normalizedId = id.split(path.sep).join('/');

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react';
  }

  if (normalizedId.includes('/node_modules/lucide-react/')) {
    return 'vendor-ui';
  }

  return undefined;
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] }),
      extraMainOutputsPlugin(),
    ],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'main/index.ts'),
      },
    },
    resolve: {
      alias: workspaceAlias(),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] })],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: path.resolve(__dirname, 'main/preload.ts'),
      },
    },
    resolve: {
      alias: workspaceAlias(),
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'renderer'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'renderer/index.html'),
        output: {
          manualChunks: rendererManualChunks,
        },
      },
    },
    resolve: {
      // The renderer holds the photo *domain model* and the shared UI
      // primitives, never the Node-side imaging or library packages: image work
      // reaches it over the typed DesktopAPI IPC contract.
      dedupe: ['react', 'react-dom', '@base-ui/react'],
      alias: [
        // Exact match first: the shared stylesheet is consumed through its
        // public `@lumacast/ui/theme.css` subpath (mapped in the package's
        // "exports"). The generic alias below would otherwise rewrite it to
        // `src/index.ts/theme.css`, which does not exist.
        {
          find: '@lumacast/ui/theme.css',
          replacement: path.resolve(__dirname, '../../packages/ui/src/theme.css'),
        },
        ...Object.entries(workspaceAlias()).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    plugins: [tailwindcss(), react()],
  },
});
