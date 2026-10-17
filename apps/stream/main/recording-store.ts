import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { isAudioTrack, isVideoEncoderFamily, supportsVideoRateControl, type AudioTrack, type RecordingContainer, type RecordingOutputSettings, type RecordingTrackId, type VideoRateControlMode } from '../shared/desktop-api';
import { RecordingFinalizer } from './recording-finalizer';

interface RecordingFile {
  path: string;
  handle: FileHandle;
  writeQueue: Promise<void>;
  offset: number;
}

interface RecordingSession {
  finalPath: string;
  settings: RecordingOutputSettings;
  files: Map<RecordingTrackId, RecordingFile>;
  closing: boolean;
  closePromise: Promise<string> | null;
}

const EXTENSIONS: Record<RecordingContainer, string> = { webm: 'webm', mkv: 'mkv', mp4: 'mp4' };
const FILTERS: Record<RecordingContainer, { name: string; extensions: string[] }> = {
  webm: { name: 'WebM video', extensions: ['webm'] },
  mkv: { name: 'Matroska video', extensions: ['mkv'] },
  mp4: { name: 'MPEG-4 video', extensions: ['mp4'] },
};

function decodeRecordingSettings(value: unknown): RecordingOutputSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid recording output settings.');
  const settings = value as Partial<RecordingOutputSettings>;
  const audioTracks = settings.audioTracks;
  if (!Array.isArray(audioTracks) || audioTracks.length > 6 || !audioTracks.every(isAudioTrack) || new Set(audioTracks).size !== audioTracks.length
    || (settings.container !== 'webm' && settings.container !== 'mkv' && settings.container !== 'mp4')
    || !Number.isInteger(settings.frameRate) || settings.frameRate! < 15 || settings.frameRate! > 60
    || !Number.isInteger(settings.videoBitrateKbps) || settings.videoBitrateKbps! < 500 || settings.videoBitrateKbps! > 50000
    || !Number.isInteger(settings.audioBitrateKbps) || settings.audioBitrateKbps! < 32 || settings.audioBitrateKbps! > 320
    || !['cbr', 'pc_vbr', 'u_vbr', 'quality'].includes(String(settings.rateControl))
    || !isVideoEncoderFamily(settings.encoder)
    || !supportsVideoRateControl(isVideoEncoderFamily(settings.encoder) ? settings.encoder : 'h264_mf', settings.rateControl as VideoRateControlMode)
    || !Number.isInteger(settings.encoderQuality) || settings.encoderQuality! < 0 || settings.encoderQuality! > 100
    || typeof settings.hardwareEncoding !== 'boolean'
    || !Number.isInteger(settings.keyframeIntervalSeconds) || settings.keyframeIntervalSeconds! < 1 || settings.keyframeIntervalSeconds! > 10) {
    throw new Error('Recording output settings are outside the supported range.');
  }
  return {
    container: settings.container,
    frameRate: settings.frameRate!,
    videoBitrateKbps: settings.videoBitrateKbps!,
    audioBitrateKbps: settings.audioBitrateKbps!,
    audioTracks: [...audioTracks] as AudioTrack[],
    rateControl: settings.rateControl as VideoRateControlMode,
    encoder: settings.encoder as RecordingOutputSettings['encoder'],
    encoderQuality: settings.encoderQuality!,
    hardwareEncoding: settings.hardwareEncoding,
    keyframeIntervalSeconds: settings.keyframeIntervalSeconds!,
  };
}

export class RecordingStore {
  private readonly sessions = new Map<string, RecordingSession>();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly videosDirectory: string,
    private readonly finalizer = new RecordingFinalizer(),
  ) {}

  async open(settingsValue: unknown): Promise<{ id: string; name: string } | null> {
    const settings = decodeRecordingSettings(settingsValue);
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = EXTENSIONS[settings.container];
    const result = await dialog.showSaveDialog(window, {
      title: 'Save recording',
      defaultPath: path.join(this.videosDirectory, `LumaStream-${stamp}.${extension}`),
      filters: [FILTERS[settings.container]],
    });
    if (result.canceled || !result.filePath) return null;
    const finalPath = path.extname(result.filePath).toLowerCase() === `.${extension}` ? result.filePath : `${result.filePath}.${extension}`;
    const id = randomUUID();
    const files = new Map<RecordingTrackId, RecordingFile>();
    try {
      files.set(0, await this.createFile(finalPath, id, 0));
      for (const track of settings.audioTracks) files.set(track, await this.createFile(finalPath, id, track));
    } catch (error) {
      await Promise.all([...files.values()].map(async (file) => {
        await file.handle.close().catch(() => undefined);
        await rm(file.path, { force: true }).catch(() => undefined);
      }));
      throw error;
    }
    this.sessions.set(id, { finalPath, settings, files, closing: false, closePromise: null });
    return { id, name: path.basename(finalPath) };
  }

  async write(id: string, trackValue: unknown, value: unknown): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || session.closing) throw new Error('Recording session was not found.');
    if (trackValue !== 0 && !isAudioTrack(trackValue)) throw new Error('Invalid recording audio track.');
    const track = trackValue as RecordingTrackId;
    const file = session.files.get(track);
    if (!file) throw new Error('This audio track is not enabled for the recording.');
    let bytes: Buffer;
    if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
    else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    else throw new Error('Recording chunk must be binary data.');
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Recording chunk is too large.');
    const chunk = Buffer.from(bytes);
    const operation = file.writeQueue.then(async () => {
      let written = 0;
      while (written < chunk.byteLength) {
        const result = await file.handle.write(chunk, written, chunk.byteLength - written, file.offset + written);
        if (result.bytesWritten === 0) throw new Error('Recording file stopped accepting data.');
        written += result.bytesWritten;
      }
      file.offset += written;
    });
    file.writeQueue = operation.then(() => undefined);
    await operation;
  }

  close(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) return Promise.reject(new Error('Recording session was not found.'));
    if (session.closePromise) return session.closePromise;
    session.closing = true;
    session.closePromise = this.finish(id, session);
    return session.closePromise;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id).catch(() => undefined)));
  }

  async abort(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.closePromise) {
      await session.closePromise.catch(() => undefined);
      return;
    }
    session.closing = true;
    await Promise.all([...session.files.values()].map(async (file) => {
      await file.writeQueue.catch(() => undefined);
      await file.handle.close().catch(() => undefined);
      await rm(file.path, { force: true }).catch(() => undefined);
    }));
    this.sessions.delete(id);
  }

  private async createFile(finalPath: string, id: string, track: RecordingTrackId): Promise<RecordingFile> {
    const label = track === 0 ? 'video' : `audio-${track}`;
    const temporaryPath = path.join(path.dirname(finalPath), `.lumastream-${id}-${label}.webm`);
    const handle = await open(temporaryPath, 'wx');
    return { path: temporaryPath, handle, writeQueue: Promise.resolve(), offset: 0 };
  }

  private async finish(id: string, session: RecordingSession): Promise<string> {
    const files = [...session.files.entries()];
    try {
      await Promise.all(files.map(([, file]) => file.writeQueue));
      await Promise.all(files.map(async ([, file]) => {
        await file.handle.sync();
        await file.handle.close();
      }));
      const video = session.files.get(0)!;
      const audioTracks = session.settings.audioTracks.map((track) => ({ track, path: session.files.get(track)!.path }));
      if (session.settings.container === 'webm' && audioTracks.length === 0) {
        await rename(video.path, session.finalPath);
        return path.basename(session.finalPath);
      }
      return await this.finalizer.finalize({ videoPath: video.path, audioTracks }, session.finalPath, session.settings);
    } catch (error) {
      await Promise.all(files.map(([, file]) => file.handle.close().catch(() => undefined)));
      const recoveryNames: string[] = [];
      for (const [track, file] of files) {
        const label = track === 0 ? 'video' : `track-${track}`;
        const recoveryPath = path.join(path.dirname(session.finalPath), `.lumastream-recovery-${label}-${randomUUID()}.webm`);
        try {
          await rename(file.path, recoveryPath);
          recoveryNames.push(path.basename(recoveryPath));
        } catch {
          await rm(file.path, { force: true }).catch(() => undefined);
        }
      }
      const detail = error instanceof Error ? error.message : 'Recording could not be completed.';
      if (recoveryNames.length > 0) throw new Error(`${detail} Recovery WebM files: ${recoveryNames.join(', ')}.`);
      throw new Error(detail);
    } finally {
      this.sessions.delete(id);
    }
  }
}
