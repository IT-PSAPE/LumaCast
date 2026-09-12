import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? '4173');
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/app/e2e',
  timeout: 60_000,
  outputDir: 'test-results',
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: 'node playwright.webserver.cjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
