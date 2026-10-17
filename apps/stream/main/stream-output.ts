import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { Readable, Writable } from 'node:stream';
import type { StreamOutputSettings, StreamRuntimeStatus } from '../shared/desktop-api';
import { bundledMediaEnginePath } from './media-engine-path';
import { buildStreamVideoEncoderArguments } from './output-encoder';

interface StreamingSession {
  id: string;
  child: ChildProcessByStdio<Writable, null, Readable>;
  closed: Promise<void>;
  close: () => void;
  stopping: boolean;
  failure: Error | null;
  progressBuffer: string;
  bitrateKbps: number;
}

function validateDestination(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Enter a valid RTMP or RTMPS server URL.');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid RTMP or RTMPS server URL.'); }
  if ((url.protocol !== 'rtmp:' && url.protocol !== 'rtmps:') || !url.hostname
    || !url.pathname || url.pathname === '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter a server URL with an RTMP or RTMPS endpoint and stream key.');
  }
  return url.toString();
}

function validateSettings(value: StreamOutputSettings): StreamOutputSettings {
  if (!value || !Number.isInteger(value.width) || value.width < 320 || value.width > 7680 || value.width % 2 !== 0
    || !Number.isInteger(value.height) || value.height < 240 || value.height > 4320 || value.height % 2 !== 0
    || !Number.isInteger(value.frameRate) || value.frameRate < 15 || value.frameRate > 60
    || !Number.isInteger(value.videoBitrateKbps) || value.videoBitrateKbps < 250 || value.videoBitrateKbps > 50000
    || !Number.isInteger(value.audioBitrateKbps) || value.audioBitrateKbps < 32 || value.audioBitrateKbps > 320) {
    throw new Error('The streaming output settings are outside the supported range.');
  }
  return value;
}

export class StreamOutput {
  private active: StreamingSession | null = null;

  constructor(private readonly getContents: () => WebContents | null) {}

  start(destinationValue: unknown, settingsValue: StreamOutputSettings): string {
    if (this.active) throw new Error('A stream is already active.');
    const destination = validateDestination(destinationValue);
    const settings = validateSettings(settingsValue);
    const child = spawn(bundledMediaEnginePath(), [
      '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:2',
      '-f', 'webm', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?',
      ...buildStreamVideoEncoderArguments(settings),
      '-c:a', 'aac', '-b:a', String(settings.audioBitrateKbps) + 'k',
      '-ar', '48000', '-ac', '2', '-f', 'flv', destination,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });

    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const session: StreamingSession = {
      id: randomUUID(), child, closed, close, stopping: false, failure: null, progressBuffer: '', bitrateKbps: 0,
    };
    this.active = session;
    this.sendStatus({ state: 'connecting' });

    child.stderr.on('data', (chunk: Buffer) => {
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
      if (sawProgress) this.sendStatus({ state: 'live', bitrateKbps: session.bitrateKbps });
    });
    child.on('error', () => {
      session.failure = new Error('The bundled media engine could not be started.');
      this.sendStatus({ state: 'error', message: session.failure.message });
    });
    child.on('close', (code) => {
      close();
      if (this.active === session && !session.stopping) {
        const message = code === 0 ? 'The stream ended.' : 'The stream ended unexpectedly. Check the server URL and encoder availability.';
        if (code === 0) this.sendStatus({ state: 'stopped' });
        else this.sendStatus({ state: 'error', message });
      }
    });
    return session.id;
  }

  async write(id: string, value: unknown): Promise<void> {
    const session = this.requireSession(id);
    if (session.failure) throw session.failure;
    if (session.child.stdin.destroyed || session.child.stdin.writableEnded) throw new Error('The stream output is no longer accepting media.');
    let bytes: Buffer;
    if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
    else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    else throw new Error('Stream data must be binary.');
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Stream media chunk is too large.');
    if (bytes.byteLength === 0) return;
    await new Promise<void>((resolve, reject) => {
      try {
        session.child.stdin.write(bytes, (error) => error ? reject(error) : resolve());
      } catch (error) { reject(error); }
    });
    if (session.failure) throw session.failure;
  }

  async stop(id: string): Promise<void> {
    const session = this.requireSession(id);
    if (!session.stopping) {
      session.stopping = true;
      if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded) session.child.stdin.end();
    }
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      session.closed,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 12000); }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill();
    if (session.child.exitCode === null && session.child.signalCode === null) {
      await Promise.race([session.closed, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    }
    if (this.active === session) this.active = null;
    const failed = Boolean(session.failure) || (session.child.exitCode !== null && session.child.exitCode !== 0);
    if (failed) this.sendStatus({ state: 'error', message: session.failure?.message ?? 'The stream ended unexpectedly.' });
    else this.sendStatus({ state: 'stopped' });
  }

  async stopAll(): Promise<void> {
    const session = this.active;
    if (!session) return;
    await this.stop(session.id).catch(() => {
      session.child.kill();
      if (this.active === session) this.active = null;
    });
  }

  private requireSession(id: string): StreamingSession {
    if (!this.active || this.active.id !== id) throw new Error('The stream session was not found.');
    return this.active;
  }

  private sendStatus(status: StreamRuntimeStatus): void {
    const contents = this.getContents();
    if (contents && !contents.isDestroyed()) contents.send('stream:output-status', status);
  }
}
