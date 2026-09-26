import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Every path in this config is app-local: builds land in apps/flux/out and
// installers in apps/flux/dist, so the Flux build never shares state with
// apps/cast. The renderer has no workspace package imports beyond
// @lumacast/ui, which ships a plain CSS subpath, so no source aliasing is
// needed here.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: path.resolve(__dirname, 'main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: path.resolve(__dirname, 'main/preload.ts')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'renderer'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'renderer/index.html')
      }
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@renderer': path.resolve(__dirname, 'renderer')
      }
    },
    plugins: [tailwindcss(), react()]
  }
});
