import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('The IOSurface/Metal test requires macOS');
}

const root = join(import.meta.dirname, '..', '..', '..');
const directory = mkdtempSync(join(tmpdir(), 'lumacast-gpu-test-'));
const binary = join(directory, 'gpu-texture-test');
try {
  const compile = spawnSync('clang++', [
    '-std=c++17', '-x', 'objective-c++',
    join(root, 'tests/packages/ndi-native/gpu-texture.test.mm'),
    join(root, 'packages/ndi-native/src/gpu-texture-mac.mm'),
    '-framework', 'Foundation', '-framework', 'IOSurface', '-framework', 'Metal',
    '-o', binary,
  ], { stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else {
    const test = spawnSync(binary, [], { stdio: 'inherit' });
    if (test.error) throw test.error;
    process.exitCode = test.status ?? 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
