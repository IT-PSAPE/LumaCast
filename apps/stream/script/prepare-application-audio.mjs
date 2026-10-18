import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: appDirectory, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error(`${label} requires \`${command}\`, which was not found on PATH${command === 'clang' ? ' (install the Xcode Command Line Tools with `xcode-select --install`)' : ''}.`);
    throw result.error;
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === 'win32') {
  const helperDirectory = path.join(appDirectory, 'native', 'audio-loopback');
  run('dotnet', [
    'publish', path.join(helperDirectory, 'AudioLoopback.csproj'),
    '--configuration', 'Release',
    '--runtime', 'win-x64',
    '--self-contained', 'true',
    '--output', path.join(helperDirectory, 'publish'),
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
  ], 'The Windows application-audio helper');
  console.log('Stream application-audio helper is ready for Windows x64.');
} else if (process.platform === 'darwin') {
  // Plain clang, no Swift: one invocation yields a universal binary for Apple silicon and Intel Macs.
  const helperDirectory = path.join(appDirectory, 'native', 'audio-tap');
  const source = path.join(helperDirectory, 'main.m');
  const buildDirectory = path.join(helperDirectory, 'build');
  const output = path.join(buildDirectory, 'lumastream-audio-tap');
  mkdirSync(buildDirectory, { recursive: true });
  if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) {
    console.log('Stream application-audio helper is up to date for macOS.');
  } else {
    run('clang', [
      '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter',
      '-mmacosx-version-min=13.0', '-arch', 'arm64', '-arch', 'x86_64',
      source, '-o', output,
      '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'AVFoundation',
    ], 'The macOS audio tap helper');
    console.log('Stream application-audio helper is ready for macOS (universal).');
  }
} else {
  console.log(`Stream application-audio capture is not available on ${process.platform}; skipping the helper build.`);
}
