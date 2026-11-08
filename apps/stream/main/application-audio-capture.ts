import { APPLICATION_AUDIO_PACKET_BYTES, APPLICATION_AUDIO_WINDOW_PACKETS, APPLICATION_AUDIO_PACKET_MS, APPLICATION_AUDIO_CONSUMPTION_MS, isApplicationAudioEpoch, type ApplicationAudioPacket } from '../shared/application-audio-transport';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import { MessageChannelMain, type MessagePortMain, type WebContents } from 'electron';
import type { Readable, Writable } from 'node:stream';
import { IPC_CHANNELS } from './ipc-channels';

export interface ApplicationAudioProcess {
  pid: number;
  name: string;
  path: string;
}

export type ApplicationAudioCaptureMessage = ApplicationAudioPacket;

type ListChild = ChildProcessByStdio<null, Readable, Readable>;
type CaptureChild = ChildProcessByStdio<Writable, Readable, Readable>;

const MAX_PROCESS_COUNT = 2048;
const MAX_LIST_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_PROCESS_NAME_LENGTH = 512;
const MAX_PROCESS_PATH_LENGTH = 32768;
const MAX_PCM_CHUNK_BYTES = 1024 * 1024;
const LIST_TIMEOUT_MS = 5000;
const CONSUMPTION_ERROR = 'Application audio stopped because the audio processor did not consume audio in time. Restart the audio source.';

export interface ApplicationAudioCaptureOptions {
  spawnProcess?: typeof spawn;
  createMessageChannel?: () => { port1: MessagePortMain; port2: MessagePortMain };
  listTimeoutMs?: number;
}

export function validateApplicationAudioProcessList(value: unknown): ApplicationAudioProcess[] {
  if (!Array.isArray(value) || value.length > MAX_PROCESS_COUNT) {
    throw new Error('The audio helper returned an invalid or oversized process list.');
  }

  const seenPids = new Set<number>();
  const processes: ApplicationAudioProcess[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('The audio helper returned an invalid process entry.');
    }
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.pid) || (item.pid as number) < 1 || (item.pid as number) > 0x7fffffff
      || typeof item.name !== 'string' || item.name.length < 1 || item.name.length > MAX_PROCESS_NAME_LENGTH
      || /[\u0000-\u001f\u007f]/.test(item.name)
      || typeof item.path !== 'string' || item.path.length < 1 || item.path.length > MAX_PROCESS_PATH_LENGTH
      || /[\u0000-\u001f\u007f]/.test(item.path) || !isAbsoluteExecutablePath(item.path)) {
      throw new Error('The audio helper returned an invalid process entry.');
    }
    if (seenPids.has(item.pid as number)) throw new Error('The audio helper returned duplicate process IDs.');
    seenPids.add(item.pid as number);
    processes.push({ pid: item.pid as number, name: item.name, path: item.path });
  }
  return processes;
}

/** Owns helper processes and PCM message ports for application-audio sources. */
export class ApplicationAudioCapture {
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly starts = new Map<string, StartReservation>();
  private readonly spawnProcess: typeof spawn;
  private readonly createMessageChannel: NonNullable<ApplicationAudioCaptureOptions['createMessageChannel']>;
  private readonly listTimeoutMs: number;

  constructor(private readonly executablePath: string, options: ApplicationAudioCaptureOptions = {}) {
    if (!isAbsoluteExecutablePath(executablePath)) throw new Error('The application-audio helper path must be absolute.');
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.createMessageChannel = options.createMessageChannel ?? (() => new MessageChannelMain());
    this.listTimeoutMs = options.listTimeoutMs ?? LIST_TIMEOUT_MS;
  }

  async list(): Promise<ApplicationAudioProcess[]> {
    const child = this.spawnProcess(this.executablePath, ['list'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ListChild;

    return new Promise<ApplicationAudioProcess[]>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let stderrBytes = 0;
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('The application-audio helper timed out while listing processes.')), this.listTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
      };
      const finish = (error: Error | null, result?: ApplicationAudioProcess[]) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          child.kill();
          reject(error);
        } else {
          resolve(result ?? []);
        }
      };
      const onStdout = (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_LIST_OUTPUT_BYTES) {
          finish(new Error('The application-audio helper process list is too large.'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      };
      const onStderr = (chunk: Buffer) => {
        if (stderrBytes >= MAX_STDERR_BYTES) return;
        const accepted = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes);
        stderrBytes += accepted.byteLength;
        stderr += accepted.toString('utf8');
      };
      const onError = (error: Error) => finish(new Error(`The application-audio helper could not list processes: ${error.message}`));
      const onClose = (code: number | null) => {
        if (code !== 0) {
          finish(new Error(stderr.trim() || `The application-audio helper exited with code ${String(code)}.`));
          return;
        }
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks, outputBytes).toString('utf8'));
          finish(null, validateApplicationAudioProcessList(parsed));
        } catch (error) {
          finish(error instanceof Error ? error : new Error('The application-audio helper returned invalid JSON.'));
        }
      };

      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.once('error', onError);
      child.once('close', onClose);
    });
  }

  async start(sourceId: string, webContents: WebContents, pid: number, expectedExecutablePath: string, epoch: string): Promise<void> {
    if (!isApplicationAudioEpoch(epoch)) throw new Error('Invalid application-audio transport epoch.');
    if (typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256 || /[\u0000-\u001f\u007f]/.test(sourceId)) {
      throw new Error('Invalid application-audio source ID.');
    }
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff
      || typeof expectedExecutablePath !== 'string' || expectedExecutablePath.length < 1
      || expectedExecutablePath.length > MAX_PROCESS_PATH_LENGTH || /[\u0000-\u001f\u007f]/.test(expectedExecutablePath)
      || !isAbsoluteExecutablePath(expectedExecutablePath)) {
      throw new Error('Invalid application-audio process identity.');
    }
    if (this.sessions.has(sourceId) || this.starts.has(sourceId)) throw new Error('Application audio is already active or starting for this source.');
    if (webContents.isDestroyed()) throw new Error('The Stream window is no longer available.');

    const reservation: StartReservation = { cancelled: false };
    this.starts.set(sourceId, reservation);
    try {
      this.throwIfStartCancelled(sourceId, reservation);
      if (webContents.isDestroyed()) throw new Error('The Stream window is no longer available.');

      // The picker catalog is intentionally filtered to visible applications with audio
      // output-session evidence. Do not use that list as capture authorization: paused
      // sessions can disappear between listing and capture. The helper validates the
      // live PID and executable path before it starts the native tap/loopback.
      this.launch(sourceId, reservation, webContents, ['capture', '--pid', String(pid), '--path', expectedExecutablePath], epoch);
    } finally {
      if (this.starts.get(sourceId) === reservation) this.starts.delete(sourceId);
    }
  }

  /**
   * Captures the whole system output mix. Only the macOS helper implements `capture --system`
   * (a Core Audio process tap); on Windows the renderer uses Electron's display loopback instead.
   */
  async startSystem(sourceId: string, webContents: WebContents, epoch: string): Promise<void> {
    if (!isApplicationAudioEpoch(epoch)) throw new Error('Invalid application-audio transport epoch.');
    if (typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256 || /[\u0000-\u001f\u007f]/.test(sourceId)) {
      throw new Error('Invalid system-audio source ID.');
    }
    if (this.sessions.has(sourceId) || this.starts.has(sourceId)) throw new Error('System audio is already active or starting for this source.');
    if (webContents.isDestroyed()) throw new Error('The Stream window is no longer available.');
    const reservation: StartReservation = { cancelled: false };
    this.starts.set(sourceId, reservation);
    try {
      this.launch(sourceId, reservation, webContents, ['capture', '--system'], epoch);
    } finally {
      if (this.starts.get(sourceId) === reservation) this.starts.delete(sourceId);
    }
  }

  private launch(sourceId: string, reservation: StartReservation, webContents: WebContents, args: string[], epoch: string): void {
    const channel = this.createMessageChannel();
    let child: CaptureChild;
    try {
      child = this.spawnProcess(this.executablePath, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as CaptureChild;
    } catch (error) {
      try { channel.port1.close(); } catch { /* The channel may already be closed. */ }
      try { channel.port2.close(); } catch { /* The channel may already be closed. */ }
      throw error;
    }
    const session = new CaptureSession(webContents, child, channel.port1);
    this.sessions.set(sourceId, session);
    try {
      session.start(() => this.remove(sourceId, session));
      webContents.postMessage(IPC_CHANNELS.applicationAudioFrame, { sourceId, epoch }, [channel.port2]);
      this.throwIfStartCancelled(sourceId, reservation);
    } catch (error) {
      try { channel.port2.close(); } catch { /* The port may already have been transferred. */ }
      this.remove(sourceId, session);
      throw error;
    }
  }

  stop(sourceId: string): void {
    const reservation = this.starts.get(sourceId);
    if (reservation) reservation.cancelled = true;
    const session = this.sessions.get(sourceId);
    if (!session) return;
    this.remove(sourceId, session);
  }

  stopAll(): void {
    for (const reservation of this.starts.values()) reservation.cancelled = true;
    for (const [sourceId, session] of this.sessions) this.remove(sourceId, session);
  }

  private throwIfStartCancelled(sourceId: string, reservation: StartReservation): void {
    if (reservation.cancelled || this.starts.get(sourceId) !== reservation) {
      throw new Error('Application audio capture start was cancelled.');
    }
  }

  private remove(sourceId: string, session: CaptureSession): void {
    if (this.sessions.get(sourceId) !== session) return;
    this.sessions.delete(sourceId);
    session.close();
  }
}

class CaptureSession {
  // One fixed assembly buffer plus five in-flight payloads. Node/OS buffering
  // remains separate; readable mode never drains it into an auxiliary queue.
  private readonly assembly = Buffer.alloc(APPLICATION_AUDIO_PACKET_BYTES);
  private assembled = 0;
  private sequence = 0;
  private acknowledged = 0;
  private readonly outstanding: Array<{ sequence: number; sentAt: number }> = [];
  private packetTimer: NodeJS.Timeout | null = null;
  private deadlineTimer: NodeJS.Timeout | null = null;
  private readonly onReadable = () => {
    if (this.closed || this.consumptionExpired()) return;
    if (this.child.stdout.readableLength > MAX_PCM_CHUNK_BYTES) {
      this.fail('The application-audio helper produced an oversized audio buffer.');
      return;
    }
    while (!this.closed && this.outstanding.length < APPLICATION_AUDIO_WINDOW_PACKETS && this.child.stdout.readableLength > 0) {
      const length = Math.min(APPLICATION_AUDIO_PACKET_BYTES - this.assembled, this.child.stdout.readableLength);
      const bytes = this.child.stdout.read(length) as Buffer | null;
      if (!bytes) break;
      bytes.copy(this.assembly, this.assembled);
      this.assembled += bytes.length;
      if (this.assembled === APPLICATION_AUDIO_PACKET_BYTES) this.flushPacket();
      else if (!this.packetTimer) this.packetTimer = setTimeout(() => {
        this.packetTimer = null;
        this.flushPacket();
      }, APPLICATION_AUDIO_PACKET_MS);
    }
  };
  private flushPacket(): void {
    if (this.closed || this.consumptionExpired() || this.outstanding.length >= APPLICATION_AUDIO_WINDOW_PACKETS) return;
    const length = this.assembled - this.assembled % 8;
    if (length === 0) return;
    if (this.packetTimer) clearTimeout(this.packetTimer);
    this.packetTimer = null;
    const buffer = new ArrayBuffer(length);
    new Uint8Array(buffer).set(this.assembly.subarray(0, length));
    this.assembly.copy(this.assembly, 0, length, this.assembled);
    this.assembled -= length;
    const sequence = ++this.sequence;
    this.outstanding.push({ sequence, sentAt: performance.now() });
    this.send({ type: 'pcm', sequence, buffer });
    this.armDeadline();
  }
  private armDeadline(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    const first = this.outstanding[0];
    if (!first || this.closed) return;
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.fail(CONSUMPTION_ERROR);
    }, Math.max(0, first.sentAt + APPLICATION_AUDIO_CONSUMPTION_MS - performance.now()));
  }
  private readonly onMessage = ({ data }: Electron.MessageEvent) => {
    if (this.closed || this.consumptionExpired()) return;
    if (data?.type === 'failed') {
      this.fail('Application audio stopped because the audio processor could not accept audio. Restart the audio source.');
      return;
    }
    if (data?.type !== 'consumed' || !Number.isSafeInteger(data.sequence) || data.sequence < 1) {
      this.fail('Application audio received an invalid consumption acknowledgement.'); return;
    }
    if (data.sequence <= this.acknowledged) return;
    if (this.outstanding[0]?.sequence !== data.sequence) {
      this.fail('Application audio received an out-of-order consumption acknowledgement.'); return;
    }
    this.outstanding.shift();
    this.acknowledged = data.sequence;
    this.armDeadline();
    this.onReadable();
  };
  private consumptionExpired(): boolean {
    const first = this.outstanding[0];
    if (!first || performance.now() < first.sentAt + APPLICATION_AUDIO_CONSUMPTION_MS) return false;
    this.fail(CONSUMPTION_ERROR);
    return true;
  }
  private fail(error: string): void { this.send({ type: 'error', error }); this.close(); }
  private readonly onStderr = (chunk: Buffer) => {
    if (this.stderrBytes >= MAX_STDERR_BYTES) return;
    const accepted = chunk.subarray(0, MAX_STDERR_BYTES - this.stderrBytes);
    this.stderrBytes += accepted.byteLength;
    this.stderr += accepted.toString('utf8');
  };
  private readonly onError = (error: Error) => {
    this.send({ type: 'error', error: `The application-audio helper failed: ${error.message}` });
    this.close();
  };
  private readonly onExit = (code: number | null) => {
    const details = this.stderr.trim();
    const message = code === 0
      ? 'The selected application audio process ended.'
      : details || `The application-audio helper stopped unexpectedly (exit code ${String(code)}).`;
    this.send({ type: 'error', error: message });
    this.close();
  };
  private readonly onClose = (code: number | null) => this.onExit(code);
  private readonly onStreamError = (error: Error) => {
    this.send({ type: 'error', error: `The application-audio helper stream failed: ${error.message}` });
    this.close();
  };
  private readonly onPortClose = () => this.close();
  private readonly onContentsDestroyed = () => this.close();
  private removeFromOwner: (() => void) | null = null;
  private closed = false;
  private forceKillTimer: NodeJS.Timeout | null = null;
  private stderr = '';
  private stderrBytes = 0;

  constructor(
    private readonly webContents: WebContents,
    private readonly child: CaptureChild,
    private readonly mainPort: MessagePortMain,
  ) {}

  start(removeFromOwner: () => void): void {
    this.removeFromOwner = removeFromOwner;
    this.child.stdout.on('readable', this.onReadable);
    this.child.stdout.once('error', this.onStreamError);
    this.child.stderr.on('data', this.onStderr);
    this.child.stderr.once('error', this.onStreamError);
    this.child.once('error', this.onError);
    this.child.once('exit', this.onExit);
    this.child.once('close', this.onClose);
    this.mainPort.on('message', this.onMessage);
    this.mainPort.once('close', this.onPortClose);
    this.webContents.once('destroyed', this.onContentsDestroyed);
    this.mainPort.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeFromOwner?.();
    this.removeFromOwner = null;
    if (this.packetTimer) clearTimeout(this.packetTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.packetTimer = null;
    this.deadlineTimer = null;
    this.outstanding.length = 0;
    this.assembled = 0;
    this.child.stdout.removeListener('readable', this.onReadable);
    this.child.stdout.removeListener('error', this.onStreamError);
    this.child.stderr.removeListener('data', this.onStderr);
    this.child.stderr.removeListener('error', this.onStreamError);
    this.child.removeListener('error', this.onError);
    this.child.removeListener('exit', this.onExit);
    this.child.removeListener('close', this.onClose);
    this.mainPort.removeListener('message', this.onMessage);
    this.mainPort.removeListener('close', this.onPortClose);
    this.webContents.removeListener('destroyed', this.onContentsDestroyed);
    try { this.mainPort.close(); } catch { /* The renderer may already have closed its channel. */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
        try { this.child.stdin.end(); } catch { /* The force-kill fallback below still stops the helper. */ }
      }
      const clearForceKill = () => {
        if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
        this.child.removeListener('exit', clearForceKill);
        this.child.removeListener('close', clearForceKill);
      };
      this.child.once('exit', clearForceKill);
      this.child.once('close', clearForceKill);
      this.forceKillTimer = setTimeout(() => {
        clearForceKill();
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
      }, 1500);
      this.forceKillTimer.unref();
    }
  }

  private send(message: ApplicationAudioCaptureMessage): void {
    if (this.closed) return;
    try {
      this.mainPort.postMessage(message);
    } catch {
      this.close();
    }
  }
}

interface StartReservation {
  cancelled: boolean;
}

function isAbsoluteExecutablePath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}
