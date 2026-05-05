import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { build as viteBuild, type Plugin } from 'vite';

// Builds app/main/ndi/ndi-host.ts as a separate CJS bundle alongside the
// main process bundle. electron-vite's default lib mode only supports a
// single entry, but the NDI service runs in an Electron utility process
// (utilityProcess.fork) which needs its own module file.
function buildNdiHostBundlePlugin(): Plugin {
  let inProgress = false;
  return {
    name: 'lumacast-ndi-host-bundle',
    enforce: 'post',
    async closeBundle() {
      if (inProgress) return;
      inProgress = true;
      try {
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
              entry: path.resolve(__dirname, 'app/main/ndi/ndi-host.ts'),
              fileName: () => 'ndi-host.js',
              formats: ['cjs']
            },
            rollupOptions: {
              external: ['electron', /^node:/, '@lumacast/ndi-native']
            }
          },
          resolve: {
            alias: {
              '@core': path.resolve(__dirname, 'app/core')
            }
          }
        });
      } finally {
        inProgress = false;
      }
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), buildNdiHostBundlePlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'app/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@core': path.resolve(__dirname, 'app/core'),
        '@database': path.resolve(__dirname, 'app/database')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: path.resolve(__dirname, 'app/main/preload.ts')
      }
    },
    resolve: {
      alias: {
        '@core': path.resolve(__dirname, 'app/core')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'app/renderer'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'app/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'app/renderer'),
        '@core': path.resolve(__dirname, 'app/core')
      }
    },
    plugins: [tailwindcss(), react()]
  }
});
