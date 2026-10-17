import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: path.resolve(__dirname, 'main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: path.resolve(__dirname, 'main/preload.ts') },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'renderer'),
    plugins: [tailwindcss(), react()],
    resolve: {
      dedupe: ['react', 'react-dom', '@base-ui/react'],
      alias: [
        { find: '@lumacast/ui/theme.css', replacement: path.resolve(__dirname, '../../packages/ui/src/theme.css') },
        { find: '@lumacast/ui', replacement: path.resolve(__dirname, '../../packages/ui/src/index.ts') },
      ],
    },
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: path.resolve(__dirname, 'renderer/index.html') },
    },
  },
});
