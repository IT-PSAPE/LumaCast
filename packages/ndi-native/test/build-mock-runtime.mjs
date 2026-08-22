import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('NDI mock runtime build is skipped outside macOS');
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'fixtures'), { recursive: true });
const result = spawnSync(
  'clang++',
  ['-shared', '-fPIC', '-o', join(here, 'fixtures', 'libndi_mock.dylib'), join(here, 'mock_ndi.cpp')],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
