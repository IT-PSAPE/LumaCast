import fs from 'node:fs';
import path from 'node:path';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

const LEVEL_BY_METHOD: Record<ConsoleMethod, string> = {
  log: 'INFO',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

let logFilePath: string | null = null;
let writeStream: fs.WriteStream | null = null;
let initialized = false;

export function initializeLogger(baseDir: string): void {
  if (initialized) return;
  initialized = true;

  const logsDir = path.join(baseDir, 'logs');
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

function patchConsole(method: ConsoleMethod): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    writeLine(LEVEL_BY_METHOD[method], args);
  };
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

