import fs from 'node:fs';
import path from 'node:path';
import type { LogReadResult, LogSessionSummary } from '@core/types';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

const LEVEL_BY_METHOD: Record<ConsoleMethod, string> = {
  log: 'INFO',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

let logFilePath: string | null = null;
let logsDirPath: string | null = null;
let writeStream: fs.WriteStream | null = null;
let initialized = false;
// Bytes the log file held when this session started (always 0 in practice
// because we open with 'a' on a unique session-stamped path, but capture
// it explicitly so the tailer's offset semantics are unambiguous).
let sessionStartByteOffset = 0;

export interface LoggerInitOptions {
  appVersion?: string;
}

export function initializeLogger(baseDir: string, options: LoggerInitOptions = {}): void {
  if (initialized) return;
  initialized = true;

  const logsDir = path.join(baseDir, 'logs');
  logsDirPath = logsDir;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (error) {
    // Without a log dir we still patch console so messages reach stderr.
    console.error('[logger] Could not create logs dir:', error);
  }

  const sessionStamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  logFilePath = path.join(logsDir, `session-${sessionStamp}.log`);
  try {
    writeStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    sessionStartByteOffset = 0;
  } catch (error) {
    writeStream = null;
    console.error('[logger] Could not open log file:', error);
  }

  patchConsole('log');
  patchConsole('info');
  patchConsole('warn');
  patchConsole('error');

  writeLine('INFO', [
    `[logger] Logging to ${logFilePath}`,
    `app=${options.appVersion ?? 'n/a'}`,
    `pid=${process.pid}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `electron=${process.versions.electron ?? 'n/a'}`,
    `node=${process.versions.node}`,
  ]);
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

export function getLogsDir(): string | null {
  return logsDirPath;
}

export function listLogSessions(): LogSessionSummary[] {
  if (!logsDirPath) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(logsDirPath, { withFileTypes: true });
  } catch (error) {
    console.error('[logger] Failed to list log sessions:', error);
    return [];
  }
  const summaries: LogSessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.log')) continue;
    const fullPath = path.join(logsDirPath, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      summaries.push({
        path: fullPath,
        fileName: entry.name,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
        isCurrent: fullPath === logFilePath,
      });
    } catch {
      // Drop entries we can't stat — likely deleted between readdir + stat.
    }
  }
  summaries.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  return summaries;
}

// Reads up to `limit` lines starting at `offset` bytes into `filePath`.
// Returns the next byte offset so the caller can incrementally tail the
// file. Negative `offset` is treated as "from end" (tailing entry point).
export function readLogSession(filePath: string, offset: number, limit: number): LogReadResult {
  // Containment check — refuse paths outside the logs dir.
  if (!logsDirPath) {
    throw new Error('Logger not initialized');
  }
  const resolved = path.resolve(filePath);
  const dir = path.resolve(logsDirPath);
  if (!resolved.startsWith(dir + path.sep) && resolved !== dir) {
    throw new Error('Refusing to read file outside logs directory');
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new Error(`Log file not found: ${(error as Error).message}`);
  }

  const totalBytes = stat.size;
  let startByte = offset;
  if (startByte < 0) {
    // Caller asked for a tail: read approx (limit * 256) bytes from the
    // end. 256 bytes/line is generous for our format.
    const approxBytes = Math.max(8 * 1024, limit * 256);
    startByte = Math.max(0, totalBytes - approxBytes);
  } else if (startByte > totalBytes) {
    startByte = totalBytes;
  }

  if (startByte >= totalBytes) {
    return { totalBytes, nextOffset: totalBytes, lines: [] };
  }

  const length = totalBytes - startByte;
  const buffer = Buffer.alloc(length);
  let fd = -1;
  try {
    fd = fs.openSync(resolved, 'r');
    fs.readSync(fd, buffer, 0, length, startByte);
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
  let text = buffer.toString('utf8');

  // If we sliced into the middle of a line, drop the partial first line so
  // the caller doesn't see a truncated entry. The next call with the
  // returned offset will pick it up cleanly.
  if (offset < 0 && startByte > 0) {
    const firstNewline = text.indexOf('\n');
    if (firstNewline > 0) {
      text = text.slice(firstNewline + 1);
    }
  }

  const lines = text.split('\n');
  // Trailing empty string when the chunk ends with a newline — discard.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  // Cap to last `limit` lines if we read more than the caller asked for.
  const trimmed = lines.length > limit ? lines.slice(lines.length - limit) : lines;

  return { totalBytes, nextOffset: totalBytes, lines: trimmed };
}

export const __sessionStartByteOffsetForTests = (): number => sessionStartByteOffset;

function patchConsole(method: ConsoleMethod): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    writeLine(deriveLevel(method, args), args);
  };
}

// Node routes process warnings (e.g., ExperimentalWarning) through
// console.error, but they're advisory — surface them as WARN.
function deriveLevel(method: ConsoleMethod, args: unknown[]): string {
  const base = LEVEL_BY_METHOD[method];
  if (base !== 'ERROR') return base;
  const first = args[0];
  if (typeof first === 'string' && /^\(node:\d+\)\s+\w*Warning:/.test(first)) {
    return 'WARN';
  }
  return base;
}

function writeLine(level: string, args: unknown[]): void {
  if (!writeStream) return;
  try {
    const ts = new Date().toISOString();
    const text = args.map(formatArg).join(' ');
    writeStream.write(`${ts} ${level} ${text}\n`);
  } catch {
    // Swallow — logging must never crash the app.
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (arg === null || arg === undefined) return String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
