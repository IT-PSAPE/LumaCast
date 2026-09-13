import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// logger.ts writes to a real fs.WriteStream opened in append mode, and the
// underlying disk write happens asynchronously relative to the console
// call that triggers it. Rather than reach into logger.ts's private
// stream, poll the real file on disk for a per-test marker string (itself
// never redacted) so each assertion waits only as long as it actually
// takes for that write to land.
async function waitForLogContent(
  filePath: string,
  predicate: (content: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  const start = Date.now();
  let content = '';
  for (;;) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      content = '';
    }
    if (predicate(content)) return content;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for expected log content. Last seen:\n${content}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

let tempDir: string;
let activeLoggerModule: typeof import('../../../app/main/logger') | null = null;

async function loadLogger(): Promise<typeof import('../../../app/main/logger')> {
  const mod = await import('../../../app/main/logger');
  activeLoggerModule = mod;
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  activeLoggerModule = null;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-logger-test-'));
});

afterEach(async () => {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  // Close the write stream and wait for it to actually finish before
  // deleting the directory it points into — otherwise a still-in-flight
  // async write can fire its 'error' event (ENOENT) after teardown and
  // surface as an unhandled rejection.
  await activeLoggerModule?.__closeLoggerForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('logger + redaction integration', () => {
  it('never writes a registered secret to the session log file', async () => {
    const { registerSecretForRedaction } = await import('../../../app/main/redaction');
    const { initializeLogger, getLogFilePath } = await loadLogger();

    registerSecretForRedaction('my-super-secret-api-token-value');
    initializeLogger(tempDir);

    console.error('MARKER-secret request failed with token my-super-secret-api-token-value');

    const filePath = getLogFilePath();
    expect(filePath).not.toBeNull();
    const log = await waitForLogContent(filePath as string, (c) => c.includes('MARKER-secret'));

    expect(log).toContain('[redacted]');
    expect(log).not.toContain('my-super-secret-api-token-value');
  });

  it('never writes an sk-ant-… key to the session log file', async () => {
    const { initializeLogger, getLogFilePath } = await loadLogger();
    initializeLogger(tempDir);

    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    console.error('MARKER-anthropic anthropic call failed', { apiKeyUsed: key });

    const filePath = getLogFilePath();
    const log = await waitForLogContent(filePath as string, (c) => c.includes('MARKER-anthropic'));

    expect(log).toContain('sk-a…[redacted]');
    expect(log).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(log).not.toContain(key);
  });

  it('redacts secrets logged at every patched console level, not just error', async () => {
    const { initializeLogger, getLogFilePath } = await loadLogger();
    initializeLogger(tempDir);

    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    console.log('MARKER-log log level', key);
    console.info('MARKER-info info level', key);
    console.warn('MARKER-warn warn level', key);

    const filePath = getLogFilePath();
    const log = await waitForLogContent(
      filePath as string,
      (c) => c.includes('MARKER-log') && c.includes('MARKER-info') && c.includes('MARKER-warn'),
    );

    expect(log).not.toContain(key);
    expect(log.split('sk-a…[redacted]').length - 1).toBe(3);
  });

  it('also redacts what is printed to the terminal passthrough, not just the file', async () => {
    const { initializeLogger } = await loadLogger();
    initializeLogger(tempDir);

    // Node's console.error ultimately calls process.stderr.write at call
    // time, so spying on it here (after the console methods are already
    // patched) still observes whatever patchConsole forwards to the
    // original console.error. This guards against a regression where the
    // raw secret reaches the terminal even though the file is clean.
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    console.error('terminal check', key);
    const printed = spy.mock.calls.map((call) => String(call[0])).join('');
    spy.mockRestore();

    expect(printed).not.toContain(key);
  });

  it('leaves ordinary log lines unredacted and in the existing format', async () => {
    const { initializeLogger, getLogFilePath } = await loadLogger();
    initializeLogger(tempDir);

    console.log('MARKER-plain plain informational message');

    const filePath = getLogFilePath();
    const log = await waitForLogContent(filePath as string, (c) => c.includes('MARKER-plain'));

    expect(log).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO .*MARKER-plain plain informational message/,
    );
  });
});
