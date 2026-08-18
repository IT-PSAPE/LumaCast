import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'benchmarks/**/*.test.ts',
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
    ],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'konva', 'react-konva'],
    alias: {
      '@renderer': path.resolve(__dirname, 'app/renderer'),
      '@rendering': path.resolve(__dirname, 'app/rendering'),
      '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
      '@lumacast/composition': path.resolve(__dirname, 'packages/composition/src/index.ts'),
      '@lumacast/automation': path.resolve(__dirname, 'packages/automation/src/index.ts'),
      '@lumacast/commands': path.resolve(__dirname, 'packages/commands/src/index.ts'),
      '@lumacast/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@lumacast/persistence-sqlite': path.resolve(__dirname, 'packages/persistence-sqlite/src/index.ts'),
      '@lumacast/engine': path.resolve(__dirname, 'packages/engine/src/index.ts'),
      '@lumacast/playback': path.resolve(__dirname, 'packages/playback/src/index.ts'),
      '@lumacast/canvas': path.resolve(__dirname, 'packages/canvas/src/index.ts'),
    },
  },
});
