import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { build as viteBuild, type Plugin } from 'vite';

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
          { source: 'app/main/ndi/ndi-host.ts', output: 'ndi-host.js' },
          { source: 'app/main/persistence/persistence-host.ts', output: 'persistence-host.js' },
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
              alias: {
                '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
                '@lumacast/composition': path.resolve(__dirname, 'packages/composition/src/index.ts'),
                '@lumacast/automation': path.resolve(__dirname, 'packages/automation/src/index.ts'),
                '@lumacast/commands': path.resolve(__dirname, 'packages/commands/src/index.ts'),
                '@lumacast/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
                '@lumacast/persistence-sqlite': path.resolve(__dirname, 'packages/persistence-sqlite/src/index.ts'),
                '@lumacast/engine': path.resolve(__dirname, 'packages/engine/src/index.ts')
              }
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
    // @lumacast/kernel has no build step (its package.json "main" points
    // straight at src/index.ts); externalizing it would emit
    // require("@lumacast/kernel") in out/main/index.js, and Node's CJS
    // loader cannot parse that raw ESM TypeScript source. Exclude it so
    // Rollup inlines it via the alias below instead.
    plugins: [
      externalizeDepsPlugin({ exclude: ['@lumacast/kernel', '@lumacast/composition', '@lumacast/automation', '@lumacast/commands', '@lumacast/protocol', '@lumacast/persistence-sqlite', '@lumacast/engine'] }),
      buildUtilityHostBundlesPlugin()
    ],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'app/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
        '@lumacast/composition': path.resolve(__dirname, 'packages/composition/src/index.ts'),
        '@lumacast/automation': path.resolve(__dirname, 'packages/automation/src/index.ts'),
        '@lumacast/commands': path.resolve(__dirname, 'packages/commands/src/index.ts'),
        '@lumacast/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
        '@lumacast/persistence-sqlite': path.resolve(__dirname, 'packages/persistence-sqlite/src/index.ts'),
        '@lumacast/engine': path.resolve(__dirname, 'packages/engine/src/index.ts')
      }
    }
  },
  preload: {
    // Same reasoning as the main config above: keep @lumacast/kernel bundled
    // rather than externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@lumacast/kernel', '@lumacast/composition', '@lumacast/automation', '@lumacast/commands', '@lumacast/protocol'] })],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: path.resolve(__dirname, 'app/main/preload.ts')
      }
    },
    resolve: {
      alias: {
        '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
        '@lumacast/composition': path.resolve(__dirname, 'packages/composition/src/index.ts'),
        '@lumacast/automation': path.resolve(__dirname, 'packages/automation/src/index.ts'),
        '@lumacast/commands': path.resolve(__dirname, 'packages/commands/src/index.ts'),
        '@lumacast/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'app/renderer'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'app/renderer/index.html'),
        output: {
          manualChunks: rendererManualChunks,
        },
      }
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'konva', 'react-konva'],
      alias: {
        '@renderer': path.resolve(__dirname, 'app/renderer'),
        '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
        '@lumacast/composition': path.resolve(__dirname, 'packages/composition/src/index.ts'),
        '@lumacast/automation': path.resolve(__dirname, 'packages/automation/src/index.ts'),
        '@lumacast/commands': path.resolve(__dirname, 'packages/commands/src/index.ts'),
        '@lumacast/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
        '@lumacast/playback': path.resolve(__dirname, 'packages/playback/src/index.ts')
      }
    },
    plugins: [tailwindcss(), react()]
  }
});
