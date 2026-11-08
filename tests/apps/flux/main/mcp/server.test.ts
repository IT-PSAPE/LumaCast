// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { test, expect, vi } from 'vitest';
import { request } from 'node:http';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  PhotoService,
  Commands,
} from '../../../../../packages/photo-library/src/index';
import { renderImage } from '../../../../../packages/photo-imaging/src/index';
import { assertAllowed, createMcpServer, MCP_REQUEST_LIMITS, startMcp } from '../../../../../apps/flux/main/mcp/server';

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lifecycle-test', version: '1' },
} };
const lifecycleHeaders = { Authorization: 'Bearer lifecycle-secret', 'content-type': 'application/json', Accept: 'application/json, text/event-stream' };

test('MCP releases an initialization when its peer aborts during asynchronous connection', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-mcp-abort-'));
  const service = await PhotoService.open(path.join(dir, 'catalog.json'));
  const server = await startMcp(new Commands(service, renderImage), { token: 'lifecycle-secret', roots: [dir] });
  let connected!: () => void;
  const ready = new Promise<void>((resolve) => { connected = resolve; });
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  const connect = McpServer.prototype.connect;
  const intercepted = vi.spyOn(McpServer.prototype, 'connect').mockImplementationOnce(async function (this: McpServer, transport) {
    await connect.call(this, transport); connected(); await paused;
  });
  const req = request(server.url, { method: 'POST', headers: lifecycleHeaders });
  req.on('error', () => {});
  try {
    req.end(JSON.stringify(initialize));
    await ready;
    expect(service.listenerCount('change')).toBe(1);
    req.destroy(new Error('Synthetic peer abort'));
    // Cleanup must occur while connect is still paused, before SDK request handling.
    await vi.waitFor(() => expect(service.listenerCount('change')).toBe(0));
    resume();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(service.listenerCount('change')).toBe(0);
  } finally { resume(); intercepted.mockRestore(); req.destroy(); await server.close(); }
});

test('MCP retains successful sessions after normal HTTP connection close', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-mcp-close-'));
  const service = await PhotoService.open(path.join(dir, 'catalog.json'));
  const server = await startMcp(new Commands(service, renderImage), { token: 'lifecycle-secret', roots: [dir] });
  try {
    const response = await fetch(server.url, { method: 'POST', headers: { ...lifecycleHeaders, Connection: 'close' }, body: JSON.stringify(initialize) });
    expect(response.status).toBe(200);
    const sessionId = response.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    await response.text();
    const listed = await fetch(server.url, { method: 'POST', headers: { ...lifecycleHeaders, Connection: 'close', 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('get_app_state');
    expect(service.listenerCount('change')).toBe(1);
  } finally { await server.close(); }
  expect(service.listenerCount('change')).toBe(0);
});

test('MCP bounds authenticated HTTP input and releases failed initialization resources', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-mcp-budget-'));
  const service = await PhotoService.open(path.join(dir, 'catalog.json'));
  const commands = new Commands(service, renderImage);
  const run = vi.spyOn(commands, 'run');
  const server = await startMcp(commands, { token: 'budget-secret', roots: [dir] });
  const headers = { Authorization: 'Bearer budget-secret', 'content-type': 'application/json' };
  const send = (body: unknown, extra = {}) => fetch(server.url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const client = new Client({ name: 'budget-test', version: '1.0.0' });
  try {
    expect((await fetch(server.url, { method: 'POST', body: '{' })).status).toBe(401);
    expect((await send({}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send(Array(101).fill({}))).status).toBe(400);
    expect((await send({ values: Array(100_000).fill(0) })).status).toBe(413);
    let nested: unknown = {};
    for (let i = 0; i <= MCP_REQUEST_LIMITS.maxDepth; i++) nested = { nested };
    expect((await send(nested)).status).toBe(413);
    const overflow = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(server.url, { method: 'POST', headers }, (res) => {
        let text = ''; res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, text }));
      });
      req.on('error', reject);
      req.write('{"value":"'); req.write('x'.repeat(MCP_REQUEST_LIMITS.maxBytes)); req.end('"}');
    });
    expect(overflow.status).toBe(413);
    expect(overflow.text).toContain('Request too large');
    for (let i = 0; i < 20; i++) {
      const failed = await send({ ...initialize, id: i }, { Accept: 'application/json' });
      expect(failed.status).toBe(406);
      await failed.text();
    }
    expect(service.listenerCount('change')).toBe(0);
    expect(run).not.toHaveBeenCalled();
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  } finally { await client.close(); await server.close(); }
  expect(service.listenerCount('change')).toBe(0);
});

test('SDK tool validation has its own element ceiling and retains valid 10k-photo batches', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-mcp-sdk-budget-'));
  const service = await PhotoService.open(path.join(dir, 'catalog.json'));
  const commands = new Commands(service, renderImage);
  const run = vi.spyOn(commands, 'run').mockResolvedValue({ ok: true } as never);
  const server = createMcpServer(commands, [dir]);
  const client = new Client({ name: 'sdk-budget-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const accepted = await client.callTool({ name: 'update_photos_metadata', arguments: { ids: Array.from({ length: 10_000 }, (_, i) => String(i)), rating: 3 } });
    expect(accepted.isError).toBeFalsy();
    expect(run).toHaveBeenCalledOnce();
    const rejected = await client.callTool({ name: 'update_photos_metadata', arguments: { ids: Array(100_001).fill('x') } });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected)).toContain('maximum of 100000 elements');
    expect(run).toHaveBeenCalledOnce();
  } finally { await client.close(); await server.close(); }
});

test('MCP authenticates, discovers, edits, previews and rejects stale/out-of-root requests', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-mcp-'));
  const source = path.join(dir, 'sample.png');
  await sharp({
    create: { width: 20, height: 10, channels: 3, background: 'red' },
  })
    .png()
    .toFile(source);
  const s = await PhotoService.open(path.join(dir, 'catalog.json'));
  const commands = new Commands(s, renderImage);
  const server = await startMcp(commands, {
    token: 'test-secret',
    roots: [dir],
  });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  try {
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await fetch(server.url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-secret',
            Origin: 'https://evil.example',
          },
        })
      ).status,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: 'Bearer test-secret' } },
      }),
    );
    let notified = false;
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, () => {
      notified = true;
    });
    await client.subscribeResource({ uri: 'lumaflux://app/state' });
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'apply_batch_edits')).toBe(true);
    expect(tools.tools.some((t) => t.name === 'update_photos_metadata')).toBe(true);
    const imported = await client.callTool({
      name: 'import_photos',
      arguments: { paths: [source] },
    });
    expect(imported.isError).toBeFalsy();
    const p = s.state().photos[0];
    const metadata = await client.callTool({
      name: 'update_photos_metadata',
      arguments: { ids: [p.id], rating: 3, favorite: true },
    });
    expect(metadata.isError).toBeFalsy();
    expect(s.photo(p.id).rating).toBe(3);
    expect(s.photo(p.id).favorite).toBe(true);
    expect(tools.tools.some((t) => t.name === 'suggest_adjustments')).toBe(true);
    const guide = await client.callTool({
      name: 'get_editing_guide',
      arguments: {},
    });
    expect(JSON.stringify(guide)).toMatch(/composition/);
    const resources = await client.listResources();
    expect(
      resources.resources.some(
        (r) => r.uri === 'lumaflux://guides/professional-editing',
      ),
    ).toBe(true);
    const prompts = await client.listPrompts();
    expect(
      prompts.prompts.some((p) => p.name === 'professional-photo-edit'),
    ).toBe(true);
    const analysis = await client.callTool({
      name: 'analyze_photo',
      arguments: { id: p.id },
    });
    expect(analysis.isError).toBeFalsy();
    expect(JSON.stringify(analysis)).toMatch(/percentiles/);
    const match = await client.callTool({
      name: 'auto_lens_correction',
      arguments: { id: p.id, expectedRevision: 0 },
    });
    expect(match.isError).toBeFalsy();
    expect(s.photo(p.id).revision).toBe(0);
    const candidate = await client.callTool({
      name: 'get_preview',
      arguments: {
        id: p.id,
        original: true,
        uncropped: true,
        patch: { exposure: 1, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      },
    });
    expect(candidate.isError).toBeFalsy();
    expect(s.photo(p.id).revision).toBe(0);
    const suggestion = await client.callTool({
      name: 'suggest_adjustments',
      arguments: { id: p.id },
    });
    expect(suggestion.isError).toBeFalsy();
    expect(s.photo(p.id).revision).toBe(0);
    expect(
      (
        await client.callTool({
          name: 'apply_edits',
          arguments: {
            id: p.id,
            expectedRevision: 0,
            patch: {
              exposure: 1,
              noiseLuminance: 40,
              noiseColor: 50,
              lensDistortion: 20,
              lensVignette: 30,
              lensRed: 5,
              lensBlue: -5,
            },
          },
        })
      ).isError,
    ).toBeFalsy();
    expect(s.photo(p.id).recipe.exposure).toBe(1);
    expect(s.photo(p.id).recipe.noiseColor).toBe(50);
    expect(s.photo(p.id).recipe.lensDistortion).toBe(20);
    const capabilities = await client.callTool({
      name: 'get_capabilities',
      arguments: {},
    });
    expect(JSON.stringify(capabilities)).toContain('noiseLuminance');
    expect(JSON.stringify(capabilities)).toContain('lensDistortion');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notified).toBe(true);
    await client.unsubscribeResource({ uri: 'lumaflux://app/state' });
    expect(
      (
        await client.callTool({
          name: 'apply_edits',
          arguments: { id: p.id, expectedRevision: 0, patch: { exposure: 2 } },
        })
      ).isError,
    ).toBe(true);
    const preview = await client.callTool({
      name: 'get_preview',
      arguments: { id: p.id },
    });
    expect(
      (preview.content as any[]).some((c) => c.type === 'image'),
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'import_photos',
          arguments: { paths: ['/etc/hosts'] },
        })
      ).isError,
    ).toBe(true);
    expect((await client.listResources()).resources.length).toBeGreaterThan(0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('allowed-root validation resolves symlinks and rejects sibling-prefix paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumaflux-roots-'));
  const allowed = path.join(dir, 'photos');
  const sibling = path.join(dir, 'photos-secret');
  await mkdir(allowed);
  await mkdir(sibling);
  const file = path.join(sibling, 'private.txt');
  await writeFile(file, 'private');
  const escapeDirectory = path.join(allowed, 'escape');
  await symlink(sibling, escapeDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(assertAllowed(file, [allowed])).rejects.toThrow(/PATH_DENIED/);
  await expect(
    assertAllowed(path.join(escapeDirectory, 'private.txt'), [allowed]),
  ).rejects.toThrow(/PATH_DENIED/);
  expect(await assertAllowed(allowed, [allowed])).toBe(await realpath(allowed));
});
