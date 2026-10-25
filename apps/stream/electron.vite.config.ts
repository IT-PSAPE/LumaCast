import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';

// Workspace packages whose package.json "main" is raw TypeScript. They must be
// bundled (aliased) rather than externalized, or the main bundle would
// require() unparseable source at runtime.
const BUNDLED_MAIN_PACKAGES = {
  '@lumacast/desktop': path.resolve(__dirname, '../../packages/desktop/src/index.ts'),
  '@lumacast/kernel': path.resolve(__dirname, '../../packages/kernel/src/index.ts'),
};

function inlineWasmDataUris() {
  return {
    name: 'stream-inline-wasm-data-uris',
    enforce: 'pre' as const,
    load(id: string) {
      const [filePath, query] = id.split('?', 2);
      if (!filePath.endsWith('.wasm') || !query?.split('&').includes('inline')) return null;
      const dataUri = `data:application/wasm;base64,${readFileSync(filePath).toString('base64')}`;
      return `export default ${JSON.stringify(dataUri)};`;
    },
  };
}

export default defineConfig(({ mode }) => {
  const appEnvironment = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  return {
  main: {
    plugins: [externalizeDepsPlugin({ exclude: Object.keys(BUNDLED_MAIN_PACKAGES) })],
    resolve: { alias: BUNDLED_MAIN_PACKAGES },
    define: {
      'process.env.LUMASTREAM_GOOGLE_CLIENT_ID': JSON.stringify(appEnvironment.LUMASTREAM_GOOGLE_CLIENT_ID ?? process.env.LUMASTREAM_GOOGLE_CLIENT_ID ?? ''),
      'process.env.LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID': JSON.stringify(appEnvironment.LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID ?? process.env.LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID ?? ''),
    },
    build: { outDir: 'out/main', lib: { entry: path.resolve(__dirname, 'main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload', lib: { entry: path.resolve(__dirname, 'main/preload.ts') } },
  },
  renderer: {
    root: path.resolve(__dirname, 'renderer'),
    plugins: [inlineWasmDataUris(), tailwindcss(), react()],
    resolve: {
      dedupe: ['react', 'react-dom', '@base-ui/react'],
      alias: [
        { find: '@lumacast/ui/theme.css', replacement: path.resolve(__dirname, '../../packages/ui/src/theme.css') },
        { find: '@lumacast/ui', replacement: path.resolve(__dirname, '../../packages/ui/src/index.ts') },
      ],
    },
    build: { assetsInlineLimit: 0, outDir: path.resolve(__dirname, 'out/renderer'), rollupOptions: { input: path.resolve(__dirname, 'renderer/index.html') } },
  },
  };
});
