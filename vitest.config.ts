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
    ],
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'app/core'),
      '@database': path.resolve(__dirname, 'app/database'),
      '@renderer': path.resolve(__dirname, 'app/renderer'),
      '@rendering': path.resolve(__dirname, 'app/rendering'),
      '@lumacast/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
    },
  },
});
