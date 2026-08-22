import { describe, expect, it, vi } from 'vitest';
import { startPersistenceShell } from './start-persistence-shell';

describe('startPersistenceShell', () => {
  it('registers IPC and creates the shell without awaiting persistence readiness', () => {
    const order: string[] = [];
    const pendingReadiness = new Promise<void>(() => undefined);
    const service = { pendingReadiness };

    const returned = startPersistenceShell({
      createService: () => {
        order.push('create-service');
        return service;
      },
      registerHandlers: vi.fn((received) => {
        expect(received).toBe(service);
        order.push('register-ipc');
      }),
      createWindow: vi.fn(() => order.push('create-window')),
    });

    expect(returned).toBe(service);
    expect(order).toEqual(['create-service', 'register-ipc', 'create-window']);
  });
});
