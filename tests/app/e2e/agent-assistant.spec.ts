import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test } from '@playwright/test';

const APP_ENTRY = path.resolve('.');
const APP_TOOLBAR_REGION = '[data-ui-region="app-toolbar"]';

test('the Assistant popover accepts pointer input and opens its settings panel', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-agent-popover-'));
  const executablePath =
    process.env.ELECTRON_BINARY ?? ((await import('electron')) as unknown as { default: string }).default;
  const app = await _electron.launch({
    executablePath,
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
  });

  try {
    const page = await app.firstWindow();
    await page.locator(APP_TOOLBAR_REGION).waitFor({ state: 'visible', timeout: 30_000 });

    await page.getByRole('button', { name: 'Assistant' }).click();
    const popover = page.locator('[data-popover-content]').filter({ hasText: 'Open settings' });
    await expect(popover).toBeVisible();
    await expect(popover).toHaveCSS('pointer-events', 'auto');

    await popover.getByRole('button', { name: 'Open settings' }).click();

    await expect(page.getByRole('combobox', { name: 'Provider' })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
