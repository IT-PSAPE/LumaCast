import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Workspace packages whose package.json "main" is raw TypeScript; they stay
// bundled via alias because Node's CJS loader cannot parse them externally.
const BUNDLED_WORKSPACE_PACKAGES = ['@lumacast/ui', '@lumacast/kernel', '@lumacast/desktop', '@lumacast/selection'] as const;

function workspaceAlias(): Record<string, string> {
  return Object.fromEntries(
    BUNDLED_WORKSPACE_PACKAGES.map((name) => [
      name,
      path.resolve(__dirname, '../../packages', name.replace('@lumacast/', ''), 'src/index.ts'),
    ]),
  );
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] })],
    resolve: { alias: workspaceAlias() },
    build: {
      outDir: 'out/main',
      lib: { entry: path.resolve(__dirname, 'main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_PACKAGES] })],
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
        { find: '@lumacast/kernel', replacement: path.resolve(__dirname, '../../packages/kernel/src/index.ts') },
        { find: '@lumacast/selection', replacement: path.resolve(__dirname, '../../packages/selection/src/index.ts') },
        { find: '@lumacast/ui', replacement: path.resolve(__dirname, '../../packages/ui/src/index.ts') },
      ],
    },
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: path.resolve(__dirname, 'renderer/index.html') },
    },
  },
});
