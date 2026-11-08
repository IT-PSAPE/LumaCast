// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const helperDirectory = path.join(root, 'apps/stream/native/audio-tap');

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw result.error;
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

describe.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('native PCM output', () => {
  it('preserves PCM and bounds real pipe pressure, deadlines, and teardown', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-pcm-writer-'));
    try {
      const binary = path.join(directory, 'pcm-writer-test');
      run('cc', [
        '-std=c11', '-D_POSIX_C_SOURCE=200809L', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread',
        '-I', helperDirectory,
        path.join(helperDirectory, 'pcm-writer.c'),
        path.join(root, 'tests/apps/stream/native/pcm-writer.fixture.c'),
        '-o', binary,
      ]);
      expect(run(binary, [])).toContain('PASS exact-fifo');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);

  it('starts a fresh deadline after an unobserved idle gap while preserving pending timeouts', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-pcm-deadline-'));
    try {
      const binary = path.join(directory, 'pcm-writer-deadline-test');
      run('cc', [
        '-std=c11', '-D_POSIX_C_SOURCE=200809L', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread',
        '-I', helperDirectory,
        path.join(root, 'tests/apps/stream/native/pcm-writer-deadline.fixture.c'),
        '-o', binary,
      ]);
      expect(run(binary, [])).toContain('PASS deadline fresh-after-empty aged-after-refill continuously-pending');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);

  it.skipIf(process.platform !== 'darwin')('compiles the actual helper for arm64 and x86_64 without capture', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-audio-helper-'));
    try {
      const binary = path.join(directory, 'lumastream-audio-tap');
      run('clang', [
        '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
        '-mmacosx-version-min=13.0', '-arch', 'arm64', '-arch', 'x86_64',
        path.join(helperDirectory, 'main.m'), path.join(helperDirectory, 'pcm-writer.c'),
        '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'AVFoundation',
        '-o', binary,
      ]);
      expect(run('lipo', ['-archs', binary]).trim().split(/\s+/).sort()).toEqual(['arm64', 'x86_64']);
      // Usage validation does not enumerate processes, create a tap, or prompt for permission.
      const usage = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 });
      expect(usage.status).toBe(2);
      expect(usage.stdout).toBe('');
      expect(usage.stderr).toContain('Usage: lumastream-audio-tap');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);

  it.skipIf(process.platform !== 'darwin')('bounds the actual conversion callback under synthetic pipe pressure', (context) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-audio-callback-'));
    try {
      const binary = path.join(directory, 'audio-tap-test');
      run('clang', [
        '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
        '-mmacosx-version-min=13.0', '-I', helperDirectory,
        path.join(root, 'tests/apps/stream/native/audio-tap.fixture.m'),
        path.join(helperDirectory, 'pcm-writer.c'),
        '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'AVFoundation',
        '-o', binary,
      ]);
      const result = spawnSync(binary, [], { cwd: root, encoding: 'utf8', timeout: 5000 });
      // Process taps/converter fixture require macOS 14.2; no capture is attempted.
      if (result.status === 3) context.skip();
      if (result.error) throw result.error;
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PASS callback blocks=5000');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);
});
