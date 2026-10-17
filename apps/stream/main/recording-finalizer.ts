import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AudioTrack, RecordingOutputSettings } from '../shared/desktop-api';
import { bundledMediaEnginePath } from './media-engine-path';
import { buildRecordingVideoEncoderArguments } from './output-encoder';

export interface RecordingMuxInputs {
  videoPath: string;
  audioTracks: Array<{ track: AudioTrack; path: string }>;
}

export function buildRecordingMuxArguments(inputs: RecordingMuxInputs, temporaryOutput: string, settings: RecordingOutputSettings): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'webm', '-i', inputs.videoPath];
  for (const audio of inputs.audioTracks) args.push('-f', 'webm', '-i', audio.path);
  args.push('-map', '0:v:0');
  inputs.audioTracks.forEach((audio, index) => {
    args.push('-map', `${index + 1}:a:0`, `-metadata:s:a:${index}`, `title=Track ${audio.track}`);
  });
  if (settings.container === 'mp4') {
    args.push(...buildRecordingVideoEncoderArguments(settings));
    if (inputs.audioTracks.length > 0) args.push('-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
    args.push('-movflags', '+faststart', '-f', 'mp4', temporaryOutput);
  } else {
    args.push('-c', 'copy', '-f', settings.container === 'mkv' ? 'matroska' : 'webm', temporaryOutput);
  }
  return args;
}

export class RecordingFinalizer {
  async finalize(inputs: RecordingMuxInputs, finalPath: string, settings: RecordingOutputSettings): Promise<string> {
    const temporaryOutput = path.join(path.dirname(finalPath), `.lumastream-${randomUUID()}.${settings.container}`);
    const args = buildRecordingMuxArguments(inputs, temporaryOutput, settings);
    try {
      await this.run(args);
      await rename(temporaryOutput, finalPath);
      await Promise.all([inputs.videoPath, ...inputs.audioTracks.map((audio) => audio.path)].map((input) => rm(input, { force: true }).catch(() => undefined)));
      return path.basename(finalPath);
    } catch (error) {
      await rm(temporaryOutput, { force: true });
      throw error instanceof Error ? error : new Error('Recording export failed.');
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
        child = spawn(bundledMediaEnginePath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        finish(new Error('The bundled media engine could not start.'));
        return;
      }
      child.stderr?.on('data', () => undefined);
      child.on('error', () => finish(new Error('The bundled media engine could not start.')));
      child.on('close', (code) => finish(code === 0 ? undefined : new Error('The recording encoder failed.')));
    });
  }
}
