import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { build as viteBuild, type Plugin } from 'vite';

// Every path in this config is app-local: sources live in apps/cast/main and
// apps/cast/renderer, builds land in apps/cast/out, and this config runs with
// apps/cast as the working directory (via the root `build:cast`/`dev:cast`
// workspace scripts), so relative outDirs stay inside the app. Workspace
// packages resolve to ../../packages/<name>/src/index.ts — the same public
// entry points tsconfig.base.json maps — because those packages ship raw
// TypeScript with no build step of their own.

// Workspace packages whose package.json "main" points straight at
// src/index.ts (raw ESM TypeScript). Externalizing them would emit
// require("@lumacast/<name>") in the bundled output, and Node's CJS loader
// cannot parse that raw source — so they stay bundled via the alias below
// instead. @lumacast/ndi-native is deliberately absent: it is a native addon
// and must stay external (see rollupOptions.external below).
const BUNDLED_WORKSPACE_PACKAGES = [
  '@lumacast/kernel',
  '@lumacast/composition',
  '@lumacast/automation',
  '@lumacast/commands',
  '@lumacast/protocol',
  '@lumacast/persistence-sqlite',
  '@lumacast/engine',
  '@lumacast/playback',
  '@lumacast/canvas',
  '@lumacast/ui',
] as const;

function workspaceAlias(): Record<string, string> {
  return Object.fromEntries(
    BUNDLED_WORKSPACE_PACKAGES.map((name) => [
      name,
      path.resolve(__dirname, '../../packages', name.replace('@lumacast/', ''), 'src/index.ts'),
    ]),
  );
}

// Builds utility-process entry points as separate CJS bundles alongside the
// main process bundle. electron-vite's default lib mode only supports one
// entry, while each utilityProcess.fork target needs its own module file.
function buildUtilityHostBundlesPlugin(): Plugin {
  let inProgress = false;
  return {
    name: 'lumacast-utility-host-bundles',
    enforce: 'post',
    async closeBundle() {
      if (inProgress) return;
      inProgress = true;
      try {
        for (const host of [
          { source: 'main/ndi/ndi-host.ts', output: 'ndi-host.js' },
          { source: 'main/persistence/persistence-host.ts', output: 'persistence-host.js' },
          { source: 'main/mcp/mcp-host.ts', output: 'mcp-host.js' },
        ]) {
          await viteBuild({
            configFile: false,
            logLevel: 'warn',
            build: {
              outDir: path.resolve(__dirname, 'out/main'),
              emptyOutDir: false,
              ssr: true,
              target: 'node22',
              sourcemap: true,
              lib: {
                entry: path.resolve(__dirname, host.source),
                fileName: () => host.output,
                formats: ['cjs']
              },
              rollupOptions: {
                external: ['electron', /^node:/, '@lumacast/ndi-native']
              }
            },
            resolve: {
              alias: workspaceAlias()
            }
          });
        }
      } finally {
        inProgress = false;
      }
    }
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
      buildUtilityHostBundlesPlugin()
    ],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'main/index.ts')
      }
    },
    resolve: {
      alias: workspaceAlias()
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] })],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: path.resolve(__dirname, 'main/preload.ts')
      }
    },
    resolve: {
      alias: workspaceAlias()
    }
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
      }
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'konva', 'react-konva'],
      alias: [
        // Exact match first: the shared stylesheet is consumed through its
        // public `@lumacast/ui/theme.css` subpath (mapped in the package's
        // "exports"). It must resolve to the CSS file itself — the generic
        // package alias below would otherwise rewrite it to
        // `src/index.ts/theme.css`, which does not exist.
        {
          find: '@lumacast/ui/theme.css',
          replacement: path.resolve(__dirname, '../../packages/ui/src/theme.css'),
        },
        { find: '@renderer', replacement: path.resolve(__dirname, 'renderer') },
        ...Object.entries(workspaceAlias()).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    plugins: [tailwindcss(), react()]
  }
});
