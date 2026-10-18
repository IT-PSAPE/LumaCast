import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { Readable, Writable } from 'node:stream';
import type { StreamOutputSettings, StreamRuntimeStatus } from '../shared/desktop-api';
import { bundledMediaEnginePath } from './media-engine-path';
import { buildStreamVideoEncoderArguments } from './output-encoder';

type OutputProcess = ChildProcessByStdio<Writable, null, Readable>;
export type StreamOutputStatusMode = 'transport' | 'external';

interface StreamingSession {
  id: string;
  outputId: string;
  statusMode: StreamOutputStatusMode;
  destination: string;
  settings: StreamOutputSettings;
  child: OutputProcess;
  closed: Promise<void>;
  close: () => void;
  stopping: boolean;
  stopTask: Promise<void> | null;
  failure: Error | null;
  progressBuffer: string;
  bitrateKbps: number;
  externallyLive: boolean;
  webmHeader: Buffer | null;
  recoveryChunks: Buffer[];
  recoveryBytes: number;
  retryCount: number;
  retryTimer: NodeJS.Timeout | null;
  reconnecting: boolean;
}

export interface StreamOutputRetryOptions {
  maxRetries: number;
  retryDelayMs: number;
  maxRecoveryBufferBytes: number;
}

const DEFAULT_RETRY_OPTIONS: StreamOutputRetryOptions = {
  maxRetries: 5,
  retryDelayMs: 1000,
  maxRecoveryBufferBytes: 64 * 1024 * 1024,
};

function validateDestination(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || value.includes('#')) {
    throw new Error('Enter a valid RTMP, RTMPS, SRT, or RIST server URL.');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid RTMP, RTMPS, SRT, or RIST server URL.'); }
  if (url.username || url.password || url.hash) {
    throw new Error('Server URLs cannot contain user information or fragments.');
  }
  if (url.protocol === 'srt:' || url.protocol === 'rist:') {
    if (!url.hostname || !url.port || (url.pathname && url.pathname !== '/')) {
      throw new Error('Enter an SRT or RIST server URL with a host and port, followed by optional FFmpeg query options.');
    }
    return url.toString();
  }
  if ((url.protocol !== 'rtmp:' && url.protocol !== 'rtmps:') || !url.hostname
    || !url.pathname || url.pathname === '/' || url.search) {
    throw new Error('Enter an RTMP or RTMPS endpoint URL with a stream key.');
  }
  return url.toString();
}

function validateSettings(value: StreamOutputSettings): StreamOutputSettings {
  if (!value || !Number.isInteger(value.width) || value.width < 320 || value.width > 7680 || value.width % 2 !== 0
    || !Number.isInteger(value.height) || value.height < 240 || value.height > 4320 || value.height % 2 !== 0
    || !Number.isFinite(value.frameRate) || value.frameRate < 1 || value.frameRate > 240
    || !Number.isInteger(value.videoBitrateKbps) || value.videoBitrateKbps < 250 || value.videoBitrateKbps > 50000
    || !Number.isInteger(value.audioBitrateKbps) || value.audioBitrateKbps < 32 || value.audioBitrateKbps > 320) {
    throw new Error('The streaming output settings are outside the supported range.');
  }
  return value;
}

export class StreamOutput {
  private readonly active = new Map<string, StreamingSession>();
  private readonly retryOptions: StreamOutputRetryOptions;

  constructor(
    private readonly getContents: () => WebContents | null,
    private readonly spawnProcess: typeof spawn = spawn,
    retryOptions: Partial<StreamOutputRetryOptions> = {},
  ) {
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  start(destinationValue: unknown, settingsValue: StreamOutputSettings, outputIdValue: unknown = 'primary', statusModeValue: unknown = 'transport'): string {
    const outputId = this.validateOutputId(outputIdValue);
    const statusMode = statusModeValue === 'transport' || statusModeValue === 'external' ? statusModeValue : null;
    if (!statusMode) throw new Error('The stream output status mode is invalid.');
    if ([...this.active.values()].some((session) => session.outputId === outputId)) {
      throw new Error('This stream output is already active.');
    }
    const destination = validateDestination(destinationValue);
    const settings = validateSettings(settingsValue);
    const child = this.spawnProcess(bundledMediaEnginePath(), this.arguments(destination, settings), {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const session: StreamingSession = {
      id: randomUUID(), outputId, statusMode, destination, settings, child, closed, close, stopping: false, stopTask: null, failure: null, progressBuffer: '', bitrateKbps: 0,
      externallyLive: false,
      webmHeader: null, recoveryChunks: [], recoveryBytes: 0, retryCount: 0, retryTimer: null, reconnecting: false,
    };
    this.active.set(session.id, session);
    this.sendStatus({ state: 'connecting' }, session.outputId);
    this.watchProcess(session, child);
    return session.id;
  }

  async write(id: string, value: unknown): Promise<void> {
    const session = this.requireSession(id);
    if (session.failure) throw session.failure;
    if (session.stopping) throw new Error('The stream output is stopping.');
    let bytes: Buffer;
    if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
    else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    else throw new Error('Stream data must be binary.');
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Stream media chunk is too large.');
    if (bytes.byteLength === 0) return;

    const isHeader = session.webmHeader === null;
    if (isHeader) session.webmHeader = Buffer.from(bytes);
    if (session.reconnecting || !this.isProcessAlive(session.child)) {
      if (!isHeader) this.bufferForRecovery(session, bytes);
      if (session.failure) throw session.failure;
      return;
    }

    const child = session.child;
    try {
      await this.writeTo(child, bytes);
    } catch {
      if (session.stopping) return;
      this.scheduleReconnect(session, child);
      if (!isHeader) this.bufferForRecovery(session, bytes);
    }
    if (session.failure) throw session.failure;
  }

  stop(id: string): Promise<void> {
    const session = this.active.get(id);
    if (!session) return Promise.resolve();
    if (session.stopTask) return session.stopTask;
    session.stopTask = this.finishStopping(session);
    return session.stopTask;
  }

  private async finishStopping(session: StreamingSession): Promise<void> {
    if (!session.stopping) {
      session.stopping = true;
      session.reconnecting = false;
      if (session.retryTimer) clearTimeout(session.retryTimer);
      session.retryTimer = null;
      if (this.isProcessAlive(session.child)) session.child.stdin.end();
      else session.close();
    }
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      session.closed,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 12000); }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (this.isProcessAlive(session.child)) session.child.kill();
    if (this.isProcessAlive(session.child)) {
      await Promise.race([session.closed, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    }
    this.active.delete(session.id);
    if (session.failure) this.sendStatus({ state: 'error', message: session.failure.message }, session.outputId);
    else this.sendStatus({ state: 'stopped' }, session.outputId);
  }

  reportStatus(id: string, status: StreamRuntimeStatus): void {
    const session = this.requireSession(id);
    if (status.state === 'error') session.failure = new Error(status.message ?? 'The streaming service reported an error.');
    if (status.state === 'live') session.externallyLive = true;
    const withBitrate = status.state === 'live' ? { ...status, bitrateKbps: session.bitrateKbps } : status;
    this.sendStatus(withBitrate, session.outputId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((session) => this.stop(session.id).catch(() => {
      if (session.retryTimer) clearTimeout(session.retryTimer);
      session.child.kill();
      this.active.delete(session.id);
    })));
  }

  private arguments(destination: string, settings: StreamOutputSettings): string[] {
    const protocol = new URL(destination).protocol;
    const outputFormat = protocol === 'srt:' || protocol === 'rist:' ? 'mpegts' : 'flv';
    return [
      '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:2',
      '-f', 'webm', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?',
      ...buildStreamVideoEncoderArguments(settings),
      '-c:a', 'aac', '-b:a', String(settings.audioBitrateKbps) + 'k',
      '-ar', '48000', '-ac', '2', '-f', outputFormat, destination,
    ];
  }

  private watchProcess(session: StreamingSession, child: OutputProcess): void {
    child.stderr.on('data', (chunk: Buffer) => {
      if (!this.isActive(session) || session.child !== child) return;
      session.progressBuffer += chunk.toString('utf8');
      const lines = session.progressBuffer.split(/\r?\n/);
      session.progressBuffer = lines.pop() ?? '';
      let sawProgress = false;
      for (const line of lines) {
        if (line.startsWith('bitrate=')) {
          const value = Number.parseFloat(line.slice('bitrate='.length).replace(/kbits\/s$/, '').trim());
          if (Number.isFinite(value)) session.bitrateKbps = Math.max(0, Math.round(value));
        }
        if (line.startsWith('progress=') && line !== 'progress=end') sawProgress = true;
      }
      if (sawProgress && (session.statusMode === 'transport' || session.externallyLive)) this.sendStatus({ state: 'live', bitrateKbps: session.bitrateKbps }, session.outputId);
    });
    child.on('error', () => this.scheduleReconnect(session, child));
    child.on('close', () => {
      if (!this.isActive(session) || session.child !== child) return;
      if (session.stopping) {
        session.close();
        return;
      }
      this.scheduleReconnect(session, child);
    });
  }

  private scheduleReconnect(session: StreamingSession, failedChild: OutputProcess): void {
    if (!this.isActive(session) || session.stopping || session.failure || session.child !== failedChild || session.retryTimer) return;
    session.reconnecting = true;
    if (session.retryCount >= this.retryOptions.maxRetries) {
      this.failSession(session, new Error('The stream could not reconnect after several attempts. Check the server URL and your network connection.'));
      return;
    }

    session.retryCount += 1;
    this.sendStatus({ state: 'connecting' }, session.outputId);
    const delay = Math.min(this.retryOptions.retryDelayMs * (2 ** (session.retryCount - 1)), 8000);
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      if (!this.isActive(session) || session.stopping || session.failure) return;
      let child: OutputProcess;
      try {
        child = this.spawnProcess(bundledMediaEnginePath(), this.arguments(session.destination, session.settings), {
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'pipe'],
        });
      } catch {
        this.scheduleReconnect(session, failedChild);
        return;
      }
      session.child = child;
      session.progressBuffer = '';
      this.watchProcess(session, child);
      void this.replayAfterReconnect(session, child);
    }, delay);
  }

  private async replayAfterReconnect(session: StreamingSession, child: OutputProcess): Promise<void> {
    try {
      if (session.webmHeader) await this.writeTo(child, session.webmHeader);
      while (session.recoveryChunks.length > 0 && this.isActive(session) && session.child === child && !session.stopping) {
        const next = session.recoveryChunks[0]!;
        await this.writeTo(child, next);
        if (session.recoveryChunks[0] === next) {
          session.recoveryChunks.shift();
          session.recoveryBytes -= next.byteLength;
        }
      }
      if (this.isActive(session) && session.child === child && !session.stopping) session.reconnecting = false;
    } catch {
      this.scheduleReconnect(session, child);
    }
  }

  private bufferForRecovery(session: StreamingSession, bytes: Buffer): void {
    if (session.recoveryBytes + bytes.byteLength > this.retryOptions.maxRecoveryBufferBytes) {
      this.failSession(session, new Error('The stream could not reconnect before its media buffer filled.'));
      return;
    }
    session.recoveryChunks.push(Buffer.from(bytes));
    session.recoveryBytes += bytes.byteLength;
  }

  private failSession(session: StreamingSession, error: Error): void {
    session.failure = error;
    session.reconnecting = false;
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = null;
    this.sendStatus({ state: 'error', message: error.message }, session.outputId);
    if (this.isProcessAlive(session.child)) session.child.kill();
    session.close();
  }

  private writeTo(child: OutputProcess, bytes: Buffer): Promise<void> {
    if (child.stdin.destroyed || child.stdin.writableEnded) return Promise.reject(new Error('The stream output is no longer accepting media.'));
    return new Promise<void>((resolve, reject) => {
      try { child.stdin.write(bytes, (error) => error ? reject(error) : resolve()); }
      catch (error) { reject(error); }
    });
  }

  private isProcessAlive(child: OutputProcess): boolean {
    return child.exitCode === null && child.signalCode === null && !child.stdin.destroyed;
  }

  private requireSession(id: string): StreamingSession {
    const session = this.active.get(id);
    if (!session) throw new Error('The stream session was not found.');
    return session;
  }

  private validateOutputId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) {
      throw new Error('The stream output identifier is invalid.');
    }
    return value;
  }

  private isActive(session: StreamingSession): boolean {
    return this.active.get(session.id) === session;
  }

  private sendStatus(status: StreamRuntimeStatus, outputId: string): void {
    const contents = this.getContents();
    if (contents && !contents.isDestroyed()) contents.send('stream:output-status', { ...status, outputId });
  }
}
