import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const directory = mkdtempSync(join(tmpdir(), 'lumacast-gpu-pixel-copy-'));
const executable = join(directory, process.platform === 'win32' ? 'gpu-pixel-copy-test.exe' : 'gpu-pixel-copy-test');
try {
  let compile;
  if (process.platform === 'win32') {
    const require = createRequire(import.meta.url);
    const nodeGypCli = require.resolve('node-gyp/bin/node-gyp.js');
    const binding = {
      targets: [{
        target_name: 'gpu_pixel_copy_test',
        type: 'executable',
        win_delay_load_hook: 'false',
        sources: [join(root, 'tests/packages/ndi-native/gpu-pixel-copy.test.cc')],
        include_dirs: [join(root, 'packages/ndi-native/src')],
        conditions: [["OS=='win'", {
          msvs_settings: { VCCLCompilerTool: { AdditionalOptions: ['/std:c++17', '/O2', '/EHsc'] } },
        }]],
      }],
    };
    writeFileSync(join(directory, 'binding.gyp'), JSON.stringify(binding, null, 2));
    compile = spawnSync(process.execPath, [nodeGypCli, 'rebuild', `--directory=${directory}`], {
      stdio: 'inherit', cwd: root,
    });
  } else {
    compile = spawnSync(process.env.CXX || 'c++', [
        '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror',
        `-I${join(root, 'packages/ndi-native/src')}`,
        join(root, 'tests/packages/ndi-native/gpu-pixel-copy.test.cc'),
        '-o', executable,
    ], { stdio: 'inherit' });
  }
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else {
    const testExecutable = process.platform === 'win32'
      ? join(directory, 'build', 'Release', 'gpu_pixel_copy_test.exe')
      : executable;
    const test = spawnSync(testExecutable, [], { stdio: 'inherit' });
    if (test.error) throw test.error;
    process.exitCode = test.status ?? 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
