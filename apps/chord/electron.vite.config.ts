import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Every path in this config is app-local: builds land in apps/chord/out and
// installers in apps/chord/dist, so the Chord build never shares state with
// the other apps.

// Workspace packages whose package.json "main" points straight at
// src/index.ts (raw ESM TypeScript, no build step of their own). Externalizing
// them would emit require("@lumacast/<name>") in the bundled output, and
// Node's CJS loader cannot parse that raw source — so they stay bundled via the
// alias below instead.
const BUNDLED_WORKSPACE_PACKAGES = [
  '@lumacast/ui',
  '@lumacast/kernel',
  '@lumacast/composition',
  '@lumacast/canvas',
  '@lumacast/markers',
] as const;

function workspaceAlias(): Record<string, string> {
  return Object.fromEntries(
    BUNDLED_WORKSPACE_PACKAGES.map((name) => [
      name,
      path.resolve(__dirname, '../../packages', name.replace('@lumacast/', ''), 'src/index.ts'),
    ]),
  );
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
  if (normalizedId.includes('/node_modules/konva/') || normalizedId.includes('/node_modules/react-konva/')) {
    return 'vendor-konva';
  }
  if (normalizedId.includes('/node_modules/mediabunny') || normalizedId.includes('/node_modules/@mediabunny/')) {
    return 'vendor-media';
  }
  return undefined;
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] })],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'main/index.ts')
      }
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
        entry: path.resolve(__dirname, 'main/preload.ts')
      }
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
      }
    },
    resolve: {
      // One React and one Konva instance only: react-konva breaks under
      // duplicate React copies.
      dedupe: ['react', 'react-dom', 'konva', 'react-konva', '@base-ui/react'],
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
        { find: '@renderer', replacement: path.resolve(__dirname, 'renderer') },
      ],
    },
    plugins: [tailwindcss(), react()]
  }
});
