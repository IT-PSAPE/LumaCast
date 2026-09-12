import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const sourceTest = spawnSync(
  process.execPath,
  ['--test', join(import.meta.dirname, 'pacing-source.node-test.mjs')],
  { stdio: 'inherit' },
);
if (sourceTest.error) throw sourceTest.error;
if (sourceTest.status !== 0) process.exit(sourceTest.status ?? 1);

if (process.platform !== 'darwin') {
  console.log('NDI native pacing test is skipped outside macOS');
  process.exit(0);
}

const electronBinary = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron',
);
const result = spawnSync(electronBinary, ['--test', join(import.meta.dirname, 'pacing.node-test.mjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
