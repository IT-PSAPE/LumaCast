// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultAgentConfig,
  matrixForTier,
  type AgentActionResponse,
  type AgentConfig,
  type AgentConfigUpdate,
  type AgentMcpClient,
} from '@lumacast/protocol';
import { McpService, type McpHostFork } from '../../../../app/main/mcp/mcp-service-proxy';
import { hashMcpToken, SessionGrants } from '../../../../app/main/agent/permission-policy';
import type { McpHostCommand, McpHostEvent } from '../../../../app/main/mcp/mcp-host-protocol';

/**
 * Unit tests for `McpService` (ADR-0039): a fake `fork` stands in for
 * `utilityProcess.fork`, returning a scripted "child" whose `postMessage`
 * calls are captured and whose `message`/`exit` listeners this file drives
 * directly — the same one-fake-utility-process shape
 * `persistence-service-proxy` and `ndi-service-proxy` tests use elsewhere.
 */

function makeClient(overrides: Partial<AgentMcpClient> = {}): AgentMcpClient {
  return {
    id: 'client-1',
    name: 'Editor',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    permissions: { matrix: matrixForTier('unrestricted'), showSafetyInterlock: false },
    tokenHash: hashMcpToken('token-1'),
    ...overrides,
  };
}

function makeConfigStore(initial: AgentConfig) {
  let config = initial;
  return {
    load: vi.fn((): AgentConfig => config),
    update: vi.fn((patch: AgentConfigUpdate): AgentConfig => {
      config = { ...config, ...patch, version: 1, mcp: { ...config.mcp, ...patch.mcp } };
      return config;
    }),
  };
}

interface FakeHost {
  postedMessages: McpHostCommand[];
  postMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  emit(event: McpHostEvent): void;
  exit(code: number | null): void;
}

function createFakeHost(): FakeHost {
  const messageListeners: ((event: McpHostEvent) => void)[] = [];
  const exitListeners: ((code: number | null) => void)[] = [];
  const postedMessages: McpHostCommand[] = [];
  return {
    postedMessages,
    postMessage: vi.fn((command: McpHostCommand) => {
      postedMessages.push(command);
    }),
    on: vi.fn((event: string, listener: never) => {
      if (event === 'message') messageListeners.push(listener as (event: McpHostEvent) => void);
      if (event === 'exit') exitListeners.push(listener as (code: number | null) => void);
    }),
    kill: vi.fn(),
    emit(event) {
      for (const listener of messageListeners) listener(event);
    },
    exit(code) {
      for (const listener of exitListeners) listener(code);
    },
  };
}

function makeBroker(respond: (input: {
  principal: unknown;
  actionId: string;
  params: unknown;
}) => AgentActionResponse | Promise<AgentActionResponse>) {
  return {
    request: vi.fn(async (input: { principal: unknown; actionId: string; params: unknown }) => respond(input)),
    beginBatch: vi.fn(() => 'batch-1'),
    endBatch: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('McpService', () => {
  let configStore: ReturnType<typeof makeConfigStore>;
  let fakeHost: FakeHost;
  let fork: McpHostFork;
  let grants: SessionGrants;

  beforeEach(() => {
    fakeHost = createFakeHost();
    fork = vi.fn(() => fakeHost as unknown as ReturnType<McpHostFork>) as unknown as McpHostFork;
    grants = new SessionGrants();
  });

  function buildService(config: AgentConfig, broker: ReturnType<typeof makeBroker>) {
    configStore = makeConfigStore(config);
    const service = new McpService({
      configStore,
      broker,
      grants,
      getWindow: () => ({ isDestroyed: () => false } as never),
      hostModulePath: '/fake/mcp-host.js',
      fork,
    });
    return service;
  }

  it('start() forks the host module and posts a start command with tools/clients/port', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    const service = buildService(config, broker);

    await service.start();

    expect(fork).toHaveBeenCalledWith('/fake/mcp-host.js', [], { serviceName: 'mcp-host', stdio: 'pipe' });
    expect(fakeHost.postedMessages).toHaveLength(1);
    const started = fakeHost.postedMessages[0];
    expect(started.type).toBe('start');
    if (started.type !== 'start') throw new Error('expected start command');
    expect(started.port).toBe(9000);
    expect(started.clients).toEqual([{ id: client.id, name: client.name, tokenHash: client.tokenHash }]);
    expect(started.tools.length).toBeGreaterThan(0);
  });

  it('a second start() while already forked is a no-op', async () => {
    const config = createDefaultAgentConfig();
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));
    await service.start();
    await service.start();
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('a ready event updates status to running with the reported port and endpoint', async () => {
    const config = createDefaultAgentConfig();
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));
    await service.start();

    expect(service.status()).toMatchObject({ running: false, port: null, endpoint: null });
    fakeHost.emit({ type: 'ready', port: 5555 });
    expect(service.status()).toMatchObject({ running: true, port: 5555, endpoint: 'http://127.0.0.1:5555/mcp' });
  });

  it('maps a successful tool call to text content and forwards a call-result', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: { hello: 'world' } }));
    const service = buildService(config, broker);
    await service.start();
    fakeHost.postedMessages.length = 0;

    fakeHost.emit({
      type: 'call',
      requestId: 'req-1',
      clientId: client.id,
      kind: 'tool',
      actionId: 'project_getOverview',
      params: {},
    });
    await flushMicrotasks();

    expect(broker.request).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'project.getOverview', decision: 'auto' }),
    );
    expect(fakeHost.postedMessages).toEqual([
      { type: 'call-result', requestId: 'req-1', result: { ok: true, content: [{ type: 'text', text: '{"hello":"world"}' }] } },
    ]);
  });

  it('maps a successful result carrying dataUrl to image content', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({
      requestId: 'r',
      outcome: 'succeeded',
      result: { dataUrl: 'data:image/png;base64,QUJD' },
    }));
    const service = buildService(config, broker);
    await service.start();
    fakeHost.postedMessages.length = 0;

    fakeHost.emit({
      type: 'call',
      requestId: 'req-2',
      clientId: client.id,
      kind: 'tool',
      actionId: 'slide_render',
      params: { slideId: 'slide-1' },
    });
    await flushMicrotasks();

    expect(fakeHost.postedMessages).toEqual([
      {
        type: 'call-result',
        requestId: 'req-2',
        result: { ok: true, content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }] },
      },
    ]);
  });

  it('denies a call whose risk class is denied in the matrix, without reaching the broker', async () => {
    const client = makeClient({ permissions: { matrix: matrixForTier('off'), showSafetyInterlock: true } });
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    const service = buildService(config, broker);
    await service.start();
    fakeHost.postedMessages.length = 0;

    fakeHost.emit({
      type: 'call',
      requestId: 'req-3',
      clientId: client.id,
      kind: 'tool',
      actionId: 'project_getOverview',
      params: {},
    });
    await flushMicrotasks();

    expect(broker.request).not.toHaveBeenCalled();
    expect(fakeHost.postedMessages).toEqual([
      { type: 'call-result', requestId: 'req-3', result: { ok: false, error: 'Denied by permission settings' } },
    ]);
  });

  it('rejects params that fail decodeActionParams, without reaching the broker', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    const service = buildService(config, broker);
    await service.start();
    fakeHost.postedMessages.length = 0;

    fakeHost.emit({
      type: 'call',
      requestId: 'req-4',
      clientId: client.id,
      kind: 'tool',
      actionId: 'slide_get',
      params: { notTheRightField: true },
    });
    await flushMicrotasks();

    expect(broker.request).not.toHaveBeenCalled();
    expect(fakeHost.postedMessages).toHaveLength(1);
    expect(fakeHost.postedMessages[0]).toMatchObject({ type: 'call-result', requestId: 'req-4', result: { ok: false } });
  });

  it('records an alwaysAllow grant so the same principal/risk is auto next time', async () => {
    const client = makeClient({ permissions: { matrix: matrixForTier('ask-everything'), showSafetyInterlock: true } });
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {}, alwaysAllow: 'read' }));
    const service = buildService(config, broker);
    await service.start();

    fakeHost.emit({
      type: 'call',
      requestId: 'req-5',
      clientId: client.id,
      kind: 'tool',
      actionId: 'project_getOverview',
      params: {},
    });
    await flushMicrotasks();

    expect(grants.has(`mcp:${client.id}`, 'read')).toBe(true);
  });

  it('answers Unknown MCP client for a clientId not in config, without reaching the broker', async () => {
    const config = createDefaultAgentConfig();
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    const service = buildService(config, broker);
    await service.start();
    fakeHost.postedMessages.length = 0;

    fakeHost.emit({
      type: 'call',
      requestId: 'req-6',
      clientId: 'ghost-client',
      kind: 'tool',
      actionId: 'project_getOverview',
      params: {},
    });
    await flushMicrotasks();

    expect(broker.request).not.toHaveBeenCalled();
    expect(fakeHost.postedMessages).toEqual([
      { type: 'call-result', requestId: 'req-6', result: { ok: false, error: 'Unknown MCP client' } },
    ]);
  });

  it('maps a resource read URI to the corresponding action and params', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: { id: 'playlist-1' } }));
    const service = buildService(config, broker);
    await service.start();

    fakeHost.emit({
      type: 'call',
      requestId: 'req-7',
      clientId: client.id,
      kind: 'resource',
      uri: 'lumacast://playlist/playlist-1',
    });
    await flushMicrotasks();

    expect(broker.request).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'playlist.get', params: { id: 'playlist-1' } }),
    );
  });

  it('maps an item resource URI including includeSlides', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    const service = buildService(config, broker);
    await service.start();

    fakeHost.emit({
      type: 'call',
      requestId: 'req-8',
      clientId: client.id,
      kind: 'resource',
      uri: 'lumacast://item/presentation/item-1',
    });
    await flushMicrotasks();

    expect(broker.request).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'item.get',
        params: { ref: { type: 'presentation', id: 'item-1' }, includeSlides: true },
      }),
    );
  });

  it('an unexpected exit reports status as not running with a lastError', async () => {
    const config = createDefaultAgentConfig();
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));
    await service.start();
    fakeHost.emit({ type: 'ready', port: 4444 });

    fakeHost.exit(1);

    const status = service.status();
    expect(status.running).toBe(false);
    expect(status.port).toBeNull();
    expect(status.lastError).toMatch(/exited unexpectedly|stopped unexpectedly/);
  });

  it('stop() posts stop, waits for stopped, then kills the host and clears status', async () => {
    const config = createDefaultAgentConfig();
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));
    await service.start();
    fakeHost.emit({ type: 'ready', port: 4444 });

    const stopPromise = service.stop();
    // The fake host acknowledges asynchronously, mirroring the real
    // stop -> stopped round trip.
    await Promise.resolve();
    fakeHost.emit({ type: 'stopped' });
    await stopPromise;

    expect(fakeHost.kill).toHaveBeenCalledOnce();
    expect(service.status()).toMatchObject({ running: false, port: null, endpoint: null });
  });

  it('refreshClients posts update-clients with the current roster once running, and is a no-op before start()', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));

    service.refreshClients();
    expect(fakeHost.postMessage).not.toHaveBeenCalled();

    await service.start();
    fakeHost.postedMessages.length = 0;
    service.refreshClients();

    expect(fakeHost.postedMessages).toEqual([
      { type: 'update-clients', clients: [{ id: client.id, name: client.name, tokenHash: client.tokenHash }] },
    ]);
  });

  it('a client-seen event updates that client\'s lastSeenAt in config', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const service = buildService(config, makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })));
    await service.start();

    expect(configStore.load().mcp.clients[0].lastSeenAt).toBeNull();
    fakeHost.emit({ type: 'client-seen', clientId: client.id });

    expect(configStore.load().mcp.clients[0].lastSeenAt).not.toBeNull();
  });

  it('a fork failure records lastError instead of throwing', async () => {
    const throwingFork = vi.fn(() => {
      throw new Error('spawn failed');
    }) as unknown as McpHostFork;
    const config = createDefaultAgentConfig();
    configStore = makeConfigStore(config);
    const service = new McpService({
      configStore,
      broker: makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} })),
      grants,
      getWindow: () => null,
      hostModulePath: '/fake/mcp-host.js',
      fork: throwingFork,
    });

    await expect(service.start()).resolves.toBeUndefined();
    expect(service.status().lastError).toMatch(/spawn failed/);
    expect(service.status().running).toBe(false);
  });

  it('refuses a call when no application window is open', async () => {
    const client = makeClient();
    const config: AgentConfig = { ...createDefaultAgentConfig(), mcp: { enabled: true, clients: [client], port: 9000 } };
    const broker = makeBroker(() => ({ requestId: 'r', outcome: 'succeeded', result: {} }));
    configStore = makeConfigStore(config);
    const service = new McpService({
      configStore,
      broker,
      grants,
      getWindow: () => null,
      hostModulePath: '/fake/mcp-host.js',
      fork,
    });
    await service.start();

    fakeHost.emit({
      type: 'call',
      requestId: 'req-9',
      clientId: client.id,
      kind: 'tool',
      actionId: 'project_getOverview',
      params: {},
    });
    await flushMicrotasks();

    expect(broker.request).not.toHaveBeenCalled();
    expect(fakeHost.postedMessages.at(-1)).toMatchObject({ requestId: 'req-9', result: { ok: false } });
  });
});
