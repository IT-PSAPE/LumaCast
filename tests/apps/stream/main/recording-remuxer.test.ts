// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { BrowserWindow, dialog } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../apps/stream/main/media-engine-path', () => ({ bundledMediaEnginePath: () => 'ffmpeg' }));

import { RecordingRemuxer, buildRecordingRemuxArguments } from '../../../../apps/stream/main/recording-remuxer';

const mockDialogs = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
} as unknown as Pick<typeof dialog, 'showOpenDialog' | 'showSaveDialog'> & {
  showOpenDialog: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
};

let directory = '';
let inputPath = '';
let outputPath = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-remux-'));
  inputPath = path.join(directory, 'capture.mkv');
  outputPath = path.join(directory, 'capture.mp4');
  await writeFile(inputPath, 'mkv recording');
  mockDialogs.showOpenDialog.mockReset().mockResolvedValue({ canceled: false, filePaths: [inputPath] });
  mockDialogs.showSaveDialog.mockReset().mockResolvedValue({ canceled: false, filePath: outputPath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function makeRemuxer(spawnProcess: (...args: unknown[]) => ChildProcess) {
  const window = { isDestroyed: () => false } as BrowserWindow;
  return new RecordingRemuxer(
    () => window,
    spawnProcess as never,
    mockDialogs,
  );
}

function successfulSpawn(): (...args: unknown[]) => ChildProcess {
  return (_executable, args) => {
    const child = new EventEmitter() as ChildProcess;
    child.stderr = new PassThrough();
    const tempPath = (args as string[]).at(-1)!;
    queueMicrotask(() => {
      void writeFile(tempPath, 'remuxed mp4').then(() => child.emit('close', 0, null));
    });
    return child;
  };
}

describe('Stream recording remux', () => {
  it('copies MKV streams into an MP4 and preserves the original recording', async () => {
    const spawnProcess = vi.fn(successfulSpawn());
    const name = await makeRemuxer(spawnProcess).remux();

    expect(name).toBe('capture.mp4');
    expect(await readFile(outputPath, 'utf8')).toBe('remuxed mp4');
    expect(await readFile(inputPath, 'utf8')).toBe('mkv recording');
    expect(spawnProcess).toHaveBeenCalledOnce();
    const args = spawnProcess.mock.calls[0]![1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-i', inputPath, '-map', '0', '-c', 'copy', '-f', 'mp4']));
    expect(args.at(-1)).toContain('.lumastream-');
  });

  it('normalizes uppercase MP4 extensions when naming its temporary output', async () => {
    const uppercaseOutput = path.join(directory, 'capture.MP4');
    const spawnProcess = vi.fn(successfulSpawn());
    mockDialogs.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: uppercaseOutput });

    await expect(makeRemuxer(spawnProcess).remux()).resolves.toBe('capture.MP4');

    const args = spawnProcess.mock.calls[0]![1] as string[];
    expect(path.basename(args.at(-1)!)).toMatch(/^\.capture\.lumastream-.+\.tmp\.mp4$/);
  });

  it('returns without starting the encoder when either file picker is cancelled', async () => {
    const spawnProcess = vi.fn(successfulSpawn());
    mockDialogs.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(makeRemuxer(spawnProcess).remux()).resolves.toBeNull();
    expect(mockDialogs.showSaveDialog).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();

    mockDialogs.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [inputPath] });
    mockDialogs.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await expect(makeRemuxer(spawnProcess).remux()).resolves.toBeNull();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('rejects unsupported or empty inputs before invoking FFmpeg', async () => {
    const spawnProcess = vi.fn(successfulSpawn());
    mockDialogs.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [outputPath] });
    await expect(makeRemuxer(spawnProcess).remux()).rejects.toThrow('Choose an MKV or WebM recording');

    await writeFile(inputPath, '');
    mockDialogs.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [inputPath] });
    await expect(makeRemuxer(spawnProcess).remux()).rejects.toThrow('empty or invalid');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('removes a partial MP4 when remuxing fails and reports codec compatibility', async () => {
    const spawnProcess = vi.fn((...args: unknown[]) => {
      const child = new EventEmitter() as ChildProcess;
      child.stderr = new PassThrough();
      const tempPath = (args[1] as string[]).at(-1)!;
      queueMicrotask(() => {
        void writeFile(tempPath, 'partial').then(() => child.emit('close', 1, null));
      });
      return child;
    });

    await expect(makeRemuxer(spawnProcess).remux()).rejects.toThrow('codec may not be supported by MP4');
    expect(await readFile(inputPath, 'utf8')).toBe('mkv recording');
    await expect(readFile(outputPath)).rejects.toThrow();
  });
});

describe('recording remux command', () => {
  it('copies the streams without transcoding and enables fast-start MP4 layout', () => {
    expect(buildRecordingRemuxArguments(inputPath, outputPath)).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', inputPath,
      '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', outputPath,
    ]);
  });
});
