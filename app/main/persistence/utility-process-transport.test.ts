import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistenceHostCommand, PersistenceHostEvent } from './persistence-protocol';

type HostListener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, HostListener>();
  const host = {
    postMessage: vi.fn(),
    on: vi.fn((event: string, listener: HostListener) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string, listener: HostListener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    }),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
  return {
    listeners,
    host,
    fork: vi.fn(() => host),
  };
});

vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork },
}));

import { forkPersistenceHost } from './utility-process-transport';

describe('forkPersistenceHost production transport', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    vi.clearAllMocks();
  });

  it('forks the dedicated utility entry and wires stdio without running SQLite in main', () => {
    forkPersistenceHost('/app/out/main/persistence-host.js');

    expect(mocks.fork).toHaveBeenCalledWith(
      '/app/out/main/persistence-host.js',
      [],
      { serviceName: 'persistence-host', stdio: 'pipe' },
    );
    expect(mocks.host.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mocks.host.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('forwards commands, host messages, exits, unsubscription, and kill', () => {
    const transport = forkPersistenceHost('/app/out/main/persistence-host.js');
    const onMessage = vi.fn();
    const onExit = vi.fn();
    const unsubscribeMessage = transport.onMessage(onMessage);
    const unsubscribeExit = transport.onExit(onExit);
    const command: PersistenceHostCommand = { type: 'call', requestId: 7, method: 'getSnapshot', args: [] };
    const event: PersistenceHostEvent = { type: 'result', requestId: 7, result: { presentations: [] } };

    transport.postMessage(command);
    mocks.listeners.get('message')?.(event);
    mocks.listeners.get('exit')?.(17);

    expect(mocks.host.postMessage).toHaveBeenCalledWith(command);
    expect(onMessage).toHaveBeenCalledWith(event);
    expect(onExit).toHaveBeenCalledWith(17);

    unsubscribeMessage();
    unsubscribeExit();
    expect(mocks.host.off).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mocks.host.off).toHaveBeenCalledWith('exit', expect.any(Function));

    transport.kill();
    expect(mocks.host.kill).toHaveBeenCalledOnce();
  });
});
