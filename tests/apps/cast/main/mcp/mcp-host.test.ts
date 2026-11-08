import crypto from 'node:crypto';
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ActionId } from '@lumacast/commands';
import type { ActionToolDefinition } from '@lumacast/protocol';
import type {
  McpCallResult,
  McpHostClient,
  McpHostCommand,
  McpHostEvent,
  McpResourceSpec,
} from '../../../../../apps/cast/main/mcp/mcp-host-protocol';

/**
 * Drives `mcp-host.ts`'s actual HTTP handler and the SDK's own `Client` +
 * `StreamableHTTPClientTransport` against it, with a fake `process.parentPort`
 * standing in for the real utility-process channel — the same pattern
 * `tests/app/main/ndi/ndi-host.test.ts` uses for the NDI host. The module is
 * dynamically re-imported per test so its module-level state (the HTTP
 * server, sessions, current tool/client roster) never leaks between tests.
 */

const TEST_TOKEN = 'test-token-0123456789';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function testClient(overrides: Partial<McpHostClient> = {}): McpHostClient {
  return { id: 'client-1', name: 'Tester', tokenHash: hashToken(TEST_TOKEN), ...overrides };
}

function fakeTool(overrides: Partial<ActionToolDefinition> = {}): ActionToolDefinition {
  return {
    name: 'project_getOverview',
    actionId: 'project.getOverview' as ActionId,
    description: 'Returns a project overview.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    ...overrides,
  };
}

const originalParentPort = (process as NodeJS.Process & { parentPort?: unknown }).parentPort;

let onMessage: ((event: { data: McpHostCommand }) => void) | null = null;
let postMessage: ReturnType<typeof vi.fn>;
let callCursor = 0;

function installFakeParentPort(): void {
  onMessage = null;
  postMessage = vi.fn();
  callCursor = 0;
  Object.defineProperty(process, 'parentPort', {
    configurable: true,
    value: {
      on: vi.fn((event: string, listener: (event: { data: McpHostCommand }) => void) => {
        if (event === 'message') onMessage = listener;
      }),
      postMessage,
    },
  });
}

function restoreParentPort(): void {
  Object.defineProperty(process, 'parentPort', { configurable: true, value: originalParentPort });
}

function hostEvents(): McpHostEvent[] {
  return postMessage.mock.calls.map((call) => call[0] as McpHostEvent);
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

async function startHost(overrides: {
  clients?: McpHostClient[];
  tools?: ActionToolDefinition[];
  resources?: McpResourceSpec[];
} = {}): Promise<number> {
  onMessage?.({
    data: {
      type: 'start',
      port: 0,
      clients: overrides.clients ?? [testClient()],
      tools: overrides.tools ?? [fakeTool()],
      resources: overrides.resources ?? [],
    },
  });
  await waitUntil(() => hostEvents().some((event) => event.type === 'ready'), 'ready event');
  const ready = hostEvents().find((event): event is Extract<McpHostEvent, { type: 'ready' }> => event.type === 'ready');
  return ready!.port;
}

/** Waits for the next not-yet-seen `call` event the host forwards, in emission order. */
async function nextCallEvent(): Promise<Extract<McpHostEvent, { type: 'call' }>> {
  await waitUntil(() => {
    const events = hostEvents();
    for (let i = callCursor; i < events.length; i += 1) {
      if (events[i].type === 'call') return true;
    }
    return false;
  }, 'a forwarded call event');
  const events = hostEvents();
  for (let i = callCursor; i < events.length; i += 1) {
    if (events[i].type === 'call') {
      callCursor = i + 1;
      return events[i] as Extract<McpHostEvent, { type: 'call' }>;
    }
  }
  throw new Error('unreachable');
}

/** Runs `action`, answers the next forwarded call with `result`, and returns `action`'s resolution. */
async function withCallAnswered<T>(action: Promise<T>, result: McpCallResult): Promise<T> {
  const call = await nextCallEvent();
  onMessage?.({ data: { type: 'call-result', requestId: call.requestId, result } });
  return action;
}

function bearer(token = TEST_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function endpointFor(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

async function stopHost(): Promise<void> {
  if (!onMessage) return;
  const before = hostEvents().length;
  onMessage({ data: { type: 'stop' } });
  await waitUntil(() => hostEvents().slice(before).some((event) => event.type === 'stopped'), 'stopped event');
}

async function connectClient(port: number, token = TEST_TOKEN): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(endpointFor(port)), { requestInit: { headers: bearer(token) } });
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

beforeEach(() => {
  vi.resetModules();
  installFakeParentPort();
});

afterEach(async () => {
  await stopHost();
  restoreParentPort();
});

describe('mcp-host HTTP security', () => {
  it('closes a new server when its peer aborts during asynchronous connection', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const port = await startHost();
    let connected!: () => void;
    const ready = new Promise<void>((resolve) => { connected = resolve; });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const connect = Server.prototype.connect;
    const close = vi.spyOn(Server.prototype, 'close');
    const intercepted = vi.spyOn(Server.prototype, 'connect').mockImplementationOnce(async function (this: InstanceType<typeof Server>, transport) {
      await connect.call(this, transport); connected(); await paused;
    });
    const req = request(endpointFor(port), { method: 'POST', headers: { ...bearer(), 'content-type': 'application/json', Accept: 'application/json, text/event-stream' } });
    req.on('error', () => {});
    try {
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'abort-test', version: '1' } } }));
      await ready;
      req.destroy(new Error('Synthetic peer abort'));
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      resume();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(close).toHaveBeenCalledOnce();
    } finally { resume(); req.destroy(); intercepted.mockRestore(); close.mockRestore(); }
  });

  it('checks authentication and session ownership before parsing the body', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const otherToken = 'another-client-token';
    const port = await startHost({ clients: [testClient(), testClient({ id: 'client-2', tokenHash: hashToken(otherToken) })] });
    const { client, transport } = await connectClient(port);
    try {
      expect((await fetch(endpointFor(port), { method: 'POST', body: '{' })).status).toBe(401);
      const response = await fetch(endpointFor(port), {
        method: 'POST',
        headers: { ...bearer(otherToken), 'mcp-session-id': transport.sessionId! },
        body: '{',
      });
      expect(response.status).toBe(404);
      expect((await client.listTools()).tools.length).toBe(1);
      expect(hostEvents().filter((event) => event.type === 'call')).toHaveLength(0);
    } finally { await client.close(); }
  });

  it('retains a successful initialization after normal HTTP connection close', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const headers = { ...bearer(), Connection: 'close', 'content-type': 'application/json', Accept: 'application/json, text/event-stream' };
    const response = await fetch(endpointFor(port), { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'close-test', version: '1' } } }) });
    expect(response.status).toBe(200);
    const sessionId = response.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    await response.text();
    const listed = await fetch(endpointFor(port), { method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('project_getOverview');
  });

  it('keeps a session when the SDK rejects its DELETE request', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const { client, transport } = await connectClient(port);
    const sessionId = transport.sessionId!;
    try {
      const rejected = await fetch(endpointFor(port), {
        method: 'DELETE',
        headers: { ...bearer(), 'mcp-session-id': sessionId, 'mcp-protocol-version': 'unsupported-version' },
      });
      expect(rejected.status).toBe(400);
      await rejected.text();
      expect((await client.listTools()).tools.length).toBe(1);
      await transport.terminateSession();
      const closed = await fetch(endpointFor(port), { headers: { ...bearer(), 'mcp-session-id': sessionId } });
      expect(closed.status).toBe(404);
    } finally { await client.close(); }
  });

  it('rejects byte, batch, aggregate-element and nesting overflow before dispatch', async () => {
    const { MCP_REQUEST_LIMITS } = await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const { client, transport } = await connectClient(port);
    const send = (body: unknown) => fetch(endpointFor(port), {
      method: 'POST',
      headers: { ...bearer(), 'mcp-session-id': transport.sessionId!, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let nested: unknown = {};
    for (let i = 0; i <= MCP_REQUEST_LIMITS.maxDepth; i++) nested = { nested };
    try {
      expect((await send({ value: 'x'.repeat(MCP_REQUEST_LIMITS.maxBytes) })).status).toBe(413);
      expect((await send(Array.from({ length: 101 }, () => ({ jsonrpc: '2.0', method: 'ping', id: 1 })))).status).toBe(400);
      expect((await send({ values: Array(100_000).fill(0) })).status).toBe(413);
      expect((await send(nested)).status).toBe(413);
      expect((await client.listTools()).tools.length).toBe(1);
      expect(hostEvents().filter((event) => event.type === 'call')).toHaveLength(0);
    } finally { await client.close(); }
  });

  it('responds 403 to a request with a disallowed Origin', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();

    const response = await fetch(endpointFor(port), {
      method: 'GET',
      headers: { ...bearer(), Origin: 'http://evil.example.com', Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(403);
  });

  it('allows a matching loopback Origin through to the normal auth/path checks', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();

    const response = await fetch(endpointFor(port), {
      method: 'GET',
      headers: { ...bearer(), Origin: `http://127.0.0.1:${port}` },
    });

    // Origin is accepted; a bare GET with a valid bearer but no existing
    // session has nothing to attach to, so it 404s rather than 403s.
    expect(response.status).not.toBe(403);
  });

  it('responds 401 with a WWW-Authenticate header when the bearer is missing', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();

    const response = await fetch(endpointFor(port), { method: 'GET' });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('responds 401 when the bearer does not match any client', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();

    const response = await fetch(endpointFor(port), { method: 'GET', headers: bearer('not-the-token') });

    expect(response.status).toBe(401);
  });

  it('responds 404 to any path other than /mcp, even without a bearer', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();

    const response = await fetch(`http://127.0.0.1:${port}/not-mcp`, { method: 'GET' });

    expect(response.status).toBe(404);
  });
});

describe('mcp-host protocol round trip', () => {
  it('completes initialize -> tools/list -> tools/call and forwards the call to main', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const tool = fakeTool({ name: 'project_getOverview', description: 'Project overview tool' });
    const port = await startHost({ tools: [tool] });

    const { client } = await connectClient(port);

    const listed = await client.listTools();
    expect(listed.tools).toEqual([
      { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
    ]);

    const result = await withCallAnswered(
      client.callTool({ name: tool.name, arguments: { foo: 'bar' } }),
      { ok: true, content: [{ type: 'text', text: '{"ok":true}' }] },
    );

    expect(result).toMatchObject({ content: [{ type: 'text', text: '{"ok":true}' }], isError: false });

    const forwarded = hostEvents().find((event): event is Extract<McpHostEvent, { type: 'call' }> => event.type === 'call');
    expect(forwarded).toMatchObject({ kind: 'tool', clientId: 'client-1', actionId: tool.name, params: { foo: 'bar' } });
  });

  it('maps a failed call result to isError: true', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const { client } = await connectClient(port);

    const result = await withCallAnswered(
      client.callTool({ name: 'project_getOverview', arguments: {} }),
      { ok: false, error: 'Denied by permission settings' },
    );

    expect(result).toMatchObject({ content: [{ type: 'text', text: 'Denied by permission settings' }], isError: true });
  });

  it('lists static resources and reads an image resource as a blob', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const resource: McpResourceSpec = {
      uri: 'lumacast://project/overview',
      name: 'Project overview',
      description: 'Summary stats',
      mimeType: 'application/json',
    };
    const port = await startHost({ resources: [resource] });
    const { client } = await connectClient(port);

    const listed = await client.listResources();
    expect(listed.resources).toEqual([resource]);

    const imageUri = 'lumacast://slide/slide-1/image';
    const read = await withCallAnswered(
      client.readResource({ uri: imageUri }),
      { ok: true, content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }] },
    );

    expect(read.contents).toEqual([{ uri: imageUri, mimeType: 'image/png', blob: 'QUJD' }]);

    const forwarded = hostEvents()
      .filter((event): event is Extract<McpHostEvent, { type: 'call' }> => event.type === 'call')
      .find((event) => event.kind === 'resource');
    expect(forwarded).toMatchObject({ kind: 'resource', uri: imageUri });
  });

  it('closes the session on DELETE, so a later request with the same session id 404s', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const { transport } = await connectClient(port);
    const sessionId = transport.sessionId;
    expect(sessionId).toBeTruthy();

    await transport.terminateSession();

    const response = await fetch(endpointFor(port), {
      method: 'GET',
      headers: { ...bearer(), 'Mcp-Session-Id': sessionId! },
    });
    expect(response.status).toBe(404);
  });

  it('throttles client-seen to at most one post across two quick requests from the same client', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    const { client } = await connectClient(port);

    await client.listTools();
    await client.listTools();

    const seenEvents = hostEvents().filter((event) => event.type === 'client-seen');
    expect(seenEvents.length).toBe(1);
  });

  it('stop closes open sessions and the listening server', async () => {
    await import('../../../../../apps/cast/main/mcp/mcp-host');
    const port = await startHost();
    await connectClient(port);

    await stopHost();

    await expect(fetch(endpointFor(port), { method: 'GET', headers: bearer() })).rejects.toThrow();
  });
});
