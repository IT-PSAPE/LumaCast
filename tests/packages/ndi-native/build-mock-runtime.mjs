import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const source = join(here, 'mock_ndi.cpp');
let result;

if (process.platform === 'darwin') {
  result = spawnSync('clang++', ['-std=c++17', '-shared', '-fPIC', '-o', join(fixtures, 'libndi_mock.dylib'), source], { stdio: 'inherit' });
} else if (process.platform === 'linux') {
  result = spawnSync('g++', ['-std=c++17', '-shared', '-fPIC', '-o', join(fixtures, 'libndi_mock.so'), source], { stdio: 'inherit' });
} else if (process.platform === 'win32') {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!existsSync(vswhere)) {
    console.log('NDI mock runtime build is skipped because Visual Studio Build Tools were not found');
    process.exit(0);
  }
  const installations = spawnSync(vswhere, ['-all', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' });
  if (installations.status !== 0 || !installations.stdout.trim()) {
    console.log('NDI mock runtime build is skipped because Visual Studio Build Tools were not found');
    process.exit(0);
  }
  const vcvars = installations.stdout
    .split(/\r?\n/)
    .map((installation) => installation.trim())
    .filter(Boolean)
    .map((installation) => join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))
    .find((candidate) => existsSync(candidate));
  if (!vcvars) {
    console.log('NDI mock runtime build is skipped because vcvars64.bat was not found');
    process.exit(0);
  }
  const output = join(fixtures, 'Processing.NDI.Lib.x64.dll');
  const scriptName = 'build_mock_ndi.cmd';
  const scriptPath = join(fixtures, scriptName);
  writeFileSync(scriptPath, [
    '@echo off',
    `call "${vcvars}" >nul`,
    'if errorlevel 1 exit /b %errorlevel%',
    `cl /nologo /EHsc /std:c++17 /LD "${source}" /link /OUT:"${output}"`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'));
  result = spawnSync('cmd.exe', ['/d', '/c', `call ${scriptName}`], { cwd: fixtures, stdio: 'inherit' });
  rmSync(scriptPath, { force: true });
} else {
  console.log(`NDI mock runtime build is skipped on ${process.platform}`);
  process.exit(0);
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
