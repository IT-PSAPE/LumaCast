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
import { test, expect } from 'vitest';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  PhotoService,
  Commands,
} from '../../../../../packages/photo-library/src/index';
import { renderImage } from '../../../../../packages/photo-imaging/src/index';
import { assertAllowed, startMcp } from '../../../../../apps/flux/main/mcp/server';

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
    const imported = await client.callTool({
      name: 'import_photos',
      arguments: { paths: [source] },
    });
    expect(imported.isError).toBeFalsy();
    const p = s.state().photos[0];
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
  await symlink(file, path.join(allowed, 'escape.txt'));
  await expect(assertAllowed(file, [allowed])).rejects.toThrow(/PATH_DENIED/);
  await expect(
    assertAllowed(path.join(allowed, 'escape.txt'), [allowed]),
  ).rejects.toThrow(/PATH_DENIED/);
  expect(await assertAllowed(allowed, [allowed])).toBe(await realpath(allowed));
});
