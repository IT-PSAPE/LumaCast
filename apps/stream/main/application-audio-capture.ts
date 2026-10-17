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

export type ApplicationAudioCaptureMessage = ArrayBuffer | { error: string };

type ListChild = ChildProcessByStdio<null, Readable, Readable>;
type CaptureChild = ChildProcessByStdio<Writable, Readable, Readable>;

const MAX_PROCESS_COUNT = 2048;
const MAX_LIST_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_PROCESS_NAME_LENGTH = 512;
const MAX_PROCESS_PATH_LENGTH = 32768;
const MAX_PCM_CHUNK_BYTES = 1024 * 1024;
const LIST_TIMEOUT_MS = 5000;

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

export function matchesApplicationAudioProcess(
  process: ApplicationAudioProcess,
  pid: number,
  expectedExecutablePath: string,
): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1 || !isAbsoluteExecutablePath(expectedExecutablePath)) return false;
  return process.pid === pid && normalizeExecutablePath(process.path) === normalizeExecutablePath(expectedExecutablePath);
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

  async start(sourceId: string, webContents: WebContents, pid: number, expectedExecutablePath: string): Promise<void> {
    if (typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256 || /[\u0000-\u001f\u007f]/.test(sourceId)) {
      throw new Error('Invalid application-audio source ID.');
    }
    if (this.sessions.has(sourceId) || this.starts.has(sourceId)) throw new Error('Application audio is already active or starting for this source.');
    if (webContents.isDestroyed()) throw new Error('The Stream window is no longer available.');

    const reservation: StartReservation = { cancelled: false };
    this.starts.set(sourceId, reservation);
    try {
      const listed = await this.list();
      this.throwIfStartCancelled(sourceId, reservation);
      const match = listed.find((item) => matchesApplicationAudioProcess(item, pid, expectedExecutablePath));
      if (!match) throw new Error('The selected application is no longer running with the expected executable.');
      if (webContents.isDestroyed()) throw new Error('The Stream window is no longer available.');

      const channel = this.createMessageChannel();
      let child: CaptureChild;
      try {
        child = this.spawnProcess(this.executablePath, ['capture', '--pid', String(pid), '--path', expectedExecutablePath], {
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
        webContents.postMessage(IPC_CHANNELS.applicationAudioFrame, sourceId, [channel.port2]);
        this.throwIfStartCancelled(sourceId, reservation);
      } catch (error) {
        try { channel.port2.close(); } catch { /* The port may already have been transferred. */ }
        this.remove(sourceId, session);
        throw error;
      }
    } finally {
      if (this.starts.get(sourceId) === reservation) this.starts.delete(sourceId);
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
  private trailingBytes = Buffer.alloc(0);
  private readonly onData = (chunk: Buffer) => {
    if (chunk.byteLength > MAX_PCM_CHUNK_BYTES) {
      this.send({ error: 'The application-audio helper produced an oversized audio chunk.' });
      this.close();
      return;
    }
    const combined = this.trailingBytes.byteLength === 0 ? chunk : Buffer.concat([this.trailingBytes, chunk]);
    const alignedLength = combined.byteLength - (combined.byteLength % 8);
    this.trailingBytes = Buffer.from(combined.subarray(alignedLength));
    if (alignedLength === 0) return;
    const copy = new Uint8Array(alignedLength);
    copy.set(combined.subarray(0, alignedLength));
    this.send(copy.buffer);
  };
  private readonly onStderr = (chunk: Buffer) => {
    if (this.stderrBytes >= MAX_STDERR_BYTES) return;
    const accepted = chunk.subarray(0, MAX_STDERR_BYTES - this.stderrBytes);
    this.stderrBytes += accepted.byteLength;
    this.stderr += accepted.toString('utf8');
  };
  private readonly onError = (error: Error) => {
    this.send({ error: `The application-audio helper failed: ${error.message}` });
    this.close();
  };
  private readonly onExit = (code: number | null) => {
    const details = this.stderr.trim();
    const message = code === 0
      ? 'The selected application audio process ended.'
      : details || `The application-audio helper stopped unexpectedly (exit code ${String(code)}).`;
    this.send({ error: message });
    this.close();
  };
  private readonly onClose = (code: number | null) => this.onExit(code);
  private readonly onStreamError = (error: Error) => {
    this.send({ error: `The application-audio helper stream failed: ${error.message}` });
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
    this.child.stdout.on('data', this.onData);
    this.child.stdout.once('error', this.onStreamError);
    this.child.stderr.on('data', this.onStderr);
    this.child.stderr.once('error', this.onStreamError);
    this.child.once('error', this.onError);
    this.child.once('exit', this.onExit);
    this.child.once('close', this.onClose);
    this.mainPort.once('close', this.onPortClose);
    this.webContents.once('destroyed', this.onContentsDestroyed);
    this.mainPort.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeFromOwner?.();
    this.removeFromOwner = null;
    this.child.stdout.removeListener('data', this.onData);
    this.child.stdout.removeListener('error', this.onStreamError);
    this.child.stderr.removeListener('data', this.onStderr);
    this.child.stderr.removeListener('error', this.onStreamError);
    this.child.removeListener('error', this.onError);
    this.child.removeListener('exit', this.onExit);
    this.child.removeListener('close', this.onClose);
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

function normalizeExecutablePath(value: string): string {
  const windowsPath = path.win32.isAbsolute(value);
  const normalized = windowsPath ? path.win32.normalize(value) : path.posix.normalize(value);
  return windowsPath ? normalized.toLowerCase() : normalized;
}
