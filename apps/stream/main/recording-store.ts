import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { createDefaultStreamRecordingPreferences, isAudioTrack, isVideoEncoderFamily, supportsVideoRateControl, type AudioTrack, type RecordingContainer, type RecordingOutputSettings, type RecordingTrackId, type VideoRateControlMode } from '../shared/desktop-api';
import { formatRecordingFilenameBase } from '../shared/recording-filename';
import { publishRecordingFileWithoutReplacing, RecordingFinalizer } from './recording-finalizer';
import type { RecordingPreferencesStore } from './recording-preferences-store';

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

function decodeRecordingSettings(value: unknown): RecordingOutputSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid recording output settings.');
  const settings = value as Partial<RecordingOutputSettings>;
  const audioTracks = settings.audioTracks;
  if (!Array.isArray(audioTracks) || audioTracks.length > 6 || !audioTracks.every(isAudioTrack) || new Set(audioTracks).size !== audioTracks.length
    || (settings.container !== 'webm' && settings.container !== 'mkv' && settings.container !== 'mp4')
    || !Number.isFinite(settings.frameRate) || settings.frameRate! < 1 || settings.frameRate! > 240
    || !Number.isInteger(settings.videoBitrateKbps) || settings.videoBitrateKbps! < 500 || settings.videoBitrateKbps! > 50000
    || !Number.isInteger(settings.audioBitrateKbps) || settings.audioBitrateKbps! < 32 || settings.audioBitrateKbps! > 320
    || !['cbr', 'pc_vbr', 'u_vbr', 'quality'].includes(String(settings.rateControl))
    || !isVideoEncoderFamily(settings.encoder)
    || !supportsVideoRateControl(settings.encoder, settings.rateControl as VideoRateControlMode)
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
    private readonly preferences: Pick<RecordingPreferencesStore, 'load'> = { load: async () => createDefaultStreamRecordingPreferences() },
    private readonly finalizer = new RecordingFinalizer(),
  ) {}

  private readonly reservedFinalPaths = new Set<string>();

  async open(settingsValue: unknown): Promise<{ id: string; name: string } | null> {
    const settings = decodeRecordingSettings(settingsValue);
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const preferences = await this.preferences.load();
    const directory = await this.resolveDirectory(preferences.directory);
    const baseName = formatRecordingFilenameBase(preferences.filenameFormat, new Date());
    const extension = EXTENSIONS[settings.container];
    const finalPath = await this.reserveFinalPath(directory, baseName, extension);
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
      this.reservedFinalPaths.delete(this.finalPathKey(finalPath));
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
    this.reservedFinalPaths.delete(this.finalPathKey(session.finalPath));
    this.sessions.delete(id);
  }

  private async resolveDirectory(configuredDirectory: string): Promise<string> {
    const directory = path.resolve(configuredDirectory || this.videosDirectory);
    try {
      if (!configuredDirectory) await mkdir(directory, { recursive: true });
      const details = await stat(directory);
      if (!details.isDirectory()) throw new Error('Recording folder is unavailable.');
      await access(directory, constants.W_OK);
      return directory;
    } catch {
      throw new Error('Recording folder is unavailable or not writable. Choose another folder in Settings.');
    }
  }

  private async reserveFinalPath(directory: string, baseName: string, extension: string): Promise<string> {
    for (let suffix = 1; suffix <= 1_000_000; suffix += 1) {
      const filename = `${baseName}${suffix === 1 ? '' : ` (${suffix})`}.${extension}`;
      const finalPath = path.join(directory, filename);
      const key = this.finalPathKey(finalPath);
      if (this.reservedFinalPaths.has(key)) continue;
      this.reservedFinalPaths.add(key);
      try {
        await access(finalPath);
        this.reservedFinalPaths.delete(key);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return finalPath;
        this.reservedFinalPaths.delete(key);
        throw error;
      }
    }
    throw new Error('Could not generate a unique recording filename.');
  }

  private finalPathKey(finalPath: string): string {
    const normalized = path.resolve(finalPath);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
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
        await publishRecordingFileWithoutReplacing(video.path, session.finalPath);
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
      this.reservedFinalPaths.delete(this.finalPathKey(session.finalPath));
      this.sessions.delete(id);
    }
  }
}
