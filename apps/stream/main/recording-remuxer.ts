import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { bundledMediaEnginePath } from './media-engine-path';

type RemuxDialogs = Pick<typeof dialog, 'showOpenDialog' | 'showSaveDialog'>;

const INPUT_EXTENSIONS = ['mkv', 'webm'] as const;

export function buildRecordingRemuxArguments(inputPath: string, temporaryOutputPath: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', temporaryOutputPath,
  ];
}

function ensureMp4Extension(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension.toLowerCase() === '.mp4') return filePath;
  return path.join(path.dirname(filePath), `${path.basename(filePath, extension)}.mp4`);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export class RecordingRemuxer {
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly dialogs: RemuxDialogs = dialog,
  ) {}

  async remux(): Promise<string | null> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');

    const inputSelection = await this.dialogs.showOpenDialog(window, {
      title: 'Choose a recording to remux',
      properties: ['openFile'],
      filters: [{ name: 'MKV or WebM Recordings', extensions: [...INPUT_EXTENSIONS] }],
    });
    const inputPath = inputSelection.filePaths[0];
    if (inputSelection.canceled || !inputPath) return null;

    const inputExtension = path.extname(inputPath).slice(1).toLowerCase();
    if (!INPUT_EXTENSIONS.includes(inputExtension as (typeof INPUT_EXTENSIONS)[number])) {
      throw new Error('Choose an MKV or WebM recording.');
    }
    const inputInfo = await stat(inputPath);
    if (!inputInfo.isFile() || inputInfo.size === 0) throw new Error('The selected recording is empty or invalid.');

    const outputSelection = await this.dialogs.showSaveDialog(window, {
      title: 'Save remuxed recording',
      defaultPath: path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.mp4`),
      filters: [{ name: 'MPEG-4 Video', extensions: ['mp4'] }],
    });
    if (outputSelection.canceled || !outputSelection.filePath) return null;

    const outputPath = ensureMp4Extension(outputSelection.filePath);
    if (samePath(inputPath, outputPath)) throw new Error('Choose a different file for the remuxed recording.');
    const temporaryPath = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath, path.extname(outputPath))}.lumastream-${randomUUID()}.tmp.mp4`,
    );

    try {
      await this.run(buildRecordingRemuxArguments(inputPath, temporaryPath));
      await rename(temporaryPath, outputPath);
      return path.basename(outputPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof Error) throw error;
      throw new Error('The recording could not be remuxed.');
    }
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      let child: ChildProcess;
      try {
        child = this.spawnProcess(bundledMediaEnginePath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        finish(new Error('The bundled media engine could not start.'));
        return;
      }
      child.stderr?.on('data', () => undefined);
      child.on('error', () => finish(new Error('The bundled media engine could not start.')));
      child.on('close', (code) => finish(code === 0
        ? undefined
        : new Error('The recording could not be remuxed. Its video or audio codec may not be supported by MP4.')));
    });
  }
}
