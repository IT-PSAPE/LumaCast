// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * The main-side half of the agent IPC surface that is not the model loop: the
 * three filesystem-reading handlers (which must refuse a path outside the
 * user's granted roots before touching a byte) and MCP client creation (which
 * must store only a hash of the bearer token).
 *
 * `electron` is mocked the same way `tests/app/main/ipc-registration.test.ts`
 * mocks it, and handlers are invoked straight off the captured
 * `ipcMain.handle` registrations.
 */

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

const { handleRegistrations, electronState } = vi.hoisted(() => ({
  handleRegistrations: new Map<string, InvokeHandler>(),
  electronState: { userDataPath: '', openDialogResult: { canceled: true, filePaths: [] as string[] } },
}));

const { catalogAdapter } = vi.hoisted(() => ({
  catalogAdapter: { listModels: vi.fn(), validateModel: vi.fn(), chat: vi.fn() },
}));
vi.mock('../../../../app/main/agent/providers', () => ({
  createProviderAdapter: vi.fn(() => catalogAdapter),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: InvokeHandler) => {
      handleRegistrations.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  Menu: {
    buildFromTemplate: vi.fn(() => []),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  },
  app: { isPackaged: false, getPath: vi.fn(() => electronState.userDataPath) },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(async () => electronState.openDialogResult),
  },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf-8')),
  },
  nativeImage: { createFromBuffer: vi.fn() },
}));

vi.mock('../../../../app/main/security', () => ({
  assertTrustedIpcSender: vi.fn(),
}));

import { IPC, matrixForTier, type AgentConfig, type AgentMcpClientCreated } from '@lumacast/protocol';
import { registerIpcHandlers } from '../../../../app/main/ipc';
import { AgentConfigStore } from '../../../../app/main/agent/agent-config-store';
import { hashMcpToken, verifyMcpToken } from '../../../../app/main/agent/permission-policy';
import type { PersistenceServiceLike } from '../../../../app/main/persistence/persistence-service-proxy';
import type { NdiServiceLike } from '@lumacast/engine';
import type { AppUpdater } from '../../../../app/main/app-updater';

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);

let base: string;
let allowedRoot: string;
let outsideRoot: string;
let configStore: AgentConfigStore;
let repositoryMethods: Record<string, ReturnType<typeof vi.fn>>;

function fakeEvent(): IpcMainInvokeEvent {
  return {} as IpcMainInvokeEvent;
}

function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handleRegistrations.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler(fakeEvent(), ...args);
}

function emptySnapshot() {
  return {
    presentations: [],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    presentationThemes: [],
    lyricThemes: [],
    overlayThemes: [],
    stages: [],
    playlists: [],
    playlistEntries: [],
    cues: [],
    macros: [],
    triggerBindings: [],
    slideTags: [],
  };
}

function makeFakeNdiService(): NdiServiceLike {
  return {
    getOutputState: vi.fn(),
    getOutputConfigs: vi.fn(),
    getDiagnostics: vi.fn(),
    setOutputEnabled: vi.fn(),
    updateOutputConfig: vi.fn(),
    receiveFrame: vi.fn(),
    receiveAudioFrame: vi.fn(),
    onOutputStateChanged: vi.fn(() => () => {}),
    onDiagnosticsChanged: vi.fn(() => () => {}),
    onFrameReleased: vi.fn(() => () => {}),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  handleRegistrations.clear();
  vi.clearAllMocks();
  catalogAdapter.listModels.mockReset();
  catalogAdapter.validateModel.mockReset();

  base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-agent-ipc-'));
  allowedRoot = path.join(base, 'allowed');
  outsideRoot = path.join(base, 'outside');
  electronState.userDataPath = path.join(base, 'userData');
  electronState.openDialogResult = { canceled: true, filePaths: [] };
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(electronState.userDataPath, { recursive: true });

  configStore = new AgentConfigStore(electronState.userDataPath);
  configStore.update({ filesystem: { allowedRoots: [allowedRoot] } });

  repositoryMethods = {
    getSnapshot: vi.fn(async () => emptySnapshot()),
    // The derivative scheduler reads the asset back on its background pass;
    // without this the import handlers still pass but log a stub-shaped
    // failure from a queue nothing here is testing.
    getMediaAsset: vi.fn(async () => null),
    createMediaAsset: vi.fn(async (input: Record<string, unknown>) => ({
      upserts: { mediaAssets: [{ id: 'asset-1', ...input }] },
      deletes: {},
    })),
    updateMediaAssetSrc: vi.fn(async (id: string, src: string) => ({
      upserts: { mediaAssets: [{ id, src }] },
      deletes: {},
    })),
  };

  registerIpcHandlers(
    repositoryMethods as unknown as PersistenceServiceLike,
    makeFakeNdiService(),
    () => null,
    {} as unknown as AppUpdater,
    {},
  );
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('agent model catalogs', () => {
  const model = { id: 'maker/model:free', label: 'Model', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: true, vendor: null };

  it('shares the OpenRouter catalog between listing and validation, with explicit refresh', async () => {
    await invokeHandler(IPC.agentSetCredential, { provider: 'openrouter', apiKey: 'test-key' });
    catalogAdapter.listModels.mockResolvedValue([model]);
    expect(await invokeHandler(IPC.agentListModels, { provider: 'openrouter' })).toEqual([model]);
    expect(await invokeHandler(IPC.agentValidateModel, { provider: 'openrouter', model: model.id })).toBe('valid');
    expect(await invokeHandler(IPC.agentListModels, { provider: 'openrouter' })).toEqual([model]);
    expect(catalogAdapter.listModels).toHaveBeenCalledTimes(1);
    expect(catalogAdapter.validateModel).not.toHaveBeenCalled();
    catalogAdapter.listModels.mockResolvedValue([]);
    await invokeHandler(IPC.agentListModels, { provider: 'openrouter', refresh: true });
    expect(await invokeHandler(IPC.agentValidateModel, { provider: 'openrouter', model: model.id })).toBe('not-found');
  });

  it('does not report unavailable when the catalog request fails', async () => {
    await invokeHandler(IPC.agentSetCredential, { provider: 'openrouter', apiKey: 'test-key' });
    catalogAdapter.listModels.mockRejectedValue(new Error('offline'));
    expect(await invokeHandler(IPC.agentValidateModel, { provider: 'openrouter', model: model.id })).toBe('unknown');
  });

  it('invalidates cached models after credential replacement and deletion', async () => {
    await invokeHandler(IPC.agentSetCredential, { provider: 'openrouter', apiKey: 'test-key' });
    catalogAdapter.listModels.mockResolvedValue([model]);
    await invokeHandler(IPC.agentListModels, { provider: 'openrouter' });
    await invokeHandler(IPC.agentSetCredential, { provider: 'openrouter', apiKey: 'replacement-key' });
    await invokeHandler(IPC.agentListModels, { provider: 'openrouter' });
    expect(catalogAdapter.listModels).toHaveBeenCalledTimes(2);
    await invokeHandler(IPC.agentDeleteCredential, { provider: 'openrouter' });
    expect(await invokeHandler(IPC.agentValidateModel, { provider: 'openrouter', model: model.id })).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Filesystem-reading handlers
// ---------------------------------------------------------------------------

describe('agentImportMedia', () => {
  it('refuses a path outside every granted root, before reaching the library', async () => {
    const file = path.join(outsideRoot, 'secret.png');
    fs.writeFileSync(file, PNG_BYTES);

    await expect(invokeHandler(IPC.agentImportMedia, { path: file })).rejects.toThrow(/outside all allowed roots/);
    expect(repositoryMethods.createMediaAsset).not.toHaveBeenCalled();
  });

  it('refuses a relative path', async () => {
    await expect(invokeHandler(IPC.agentImportMedia, { path: 'relative.png' })).rejects.toThrow(/absolute/);
    expect(repositoryMethods.createMediaAsset).not.toHaveBeenCalled();
  });

  it('rejects a malformed input before authorizing anything', async () => {
    await expect(invokeHandler(IPC.agentImportMedia, { path: 42 })).rejects.toThrow();
    await expect(invokeHandler(IPC.agentImportMedia, { path: '/a.png', bogus: true })).rejects.toThrow();
  });

  it('adopts a granted file into the library and creates the asset with the sniffed type', async () => {
    const file = path.join(allowedRoot, 'logo.png');
    fs.writeFileSync(file, PNG_BYTES);

    await invokeHandler(IPC.agentImportMedia, { path: file });

    expect(repositoryMethods.createMediaAsset).toHaveBeenCalledTimes(1);
    const input = repositoryMethods.createMediaAsset.mock.calls[0][0] as { name: string; type: string; src: string };
    expect(input.name).toBe('logo.png');
    // Sniffed from the magic bytes, not from the extension the caller supplied.
    expect(input.type).toBe('image');
    // The stored source is a library reference, never the caller's path.
    expect(input.src).not.toBe(file);
    expect(input.src.startsWith('cast-media://library/')).toBe(true);
  });

  it('uses the caller’s name when it supplies one', async () => {
    const file = path.join(allowedRoot, 'logo.png');
    fs.writeFileSync(file, PNG_BYTES);

    await invokeHandler(IPC.agentImportMedia, { path: file, name: 'Church logo', type: 'image' });

    expect(repositoryMethods.createMediaAsset.mock.calls[0][0]).toMatchObject({ name: 'Church logo', type: 'image' });
  });

  it('refuses a declared type that contradicts the file’s actual bytes', async () => {
    const file = path.join(allowedRoot, 'logo.png');
    fs.writeFileSync(file, PNG_BYTES);

    await expect(invokeHandler(IPC.agentImportMedia, { path: file, type: 'audio' })).rejects.toThrow();
    expect(repositoryMethods.createMediaAsset).not.toHaveBeenCalled();
  });
});

describe('agentReplaceMediaSource', () => {
  it('refuses a path outside every granted root', async () => {
    const file = path.join(outsideRoot, 'other.png');
    fs.writeFileSync(file, PNG_BYTES);

    await expect(invokeHandler(IPC.agentReplaceMediaSource, { id: 'asset-1', path: file })).rejects.toThrow(
      /outside all allowed roots/,
    );
    expect(repositoryMethods.updateMediaAssetSrc).not.toHaveBeenCalled();
  });

  it('adopts a granted file and repoints the asset at the library copy', async () => {
    const file = path.join(allowedRoot, 'replacement.png');
    fs.writeFileSync(file, PNG_BYTES);

    await invokeHandler(IPC.agentReplaceMediaSource, { id: 'asset-1', path: file });

    expect(repositoryMethods.updateMediaAssetSrc).toHaveBeenCalledTimes(1);
    const [id, src] = repositoryMethods.updateMediaAssetSrc.mock.calls[0] as [string, string];
    expect(id).toBe('asset-1');
    expect(src.startsWith('cast-media://library/')).toBe(true);
  });
});

describe('agentExtractDocumentText', () => {
  it('refuses a path outside every granted root', async () => {
    const file = path.join(outsideRoot, 'notes.txt');
    fs.writeFileSync(file, 'secret notes');

    await expect(invokeHandler(IPC.agentExtractDocumentText, { path: file })).rejects.toThrow(
      /outside all allowed roots/,
    );
  });

  it('extracts a granted text file and reports the truncation budget', async () => {
    const file = path.join(allowedRoot, 'notes.txt');
    fs.writeFileSync(file, 'Line one\nLine two');

    const result = (await invokeHandler(IPC.agentExtractDocumentText, { path: file })) as Record<string, unknown>;

    expect(result).toMatchObject({
      fileName: 'notes.txt',
      kind: 'text',
      text: 'Line one\nLine two',
      truncated: false,
      pageCount: null,
    });
  });

  it('honours maxChars', async () => {
    const file = path.join(allowedRoot, 'notes.txt');
    fs.writeFileSync(file, 'abcdefghij');

    const result = (await invokeHandler(IPC.agentExtractDocumentText, { path: file, maxChars: 4 })) as {
      text: string;
      truncated: boolean;
    };

    expect(result.text).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Filesystem grants
// ---------------------------------------------------------------------------

describe('agentGrantFilesystemRoot / agentRevokeFilesystemRoot', () => {
  it('returns null and changes nothing when the picker is cancelled', async () => {
    electronState.openDialogResult = { canceled: true, filePaths: [] };
    await expect(invokeHandler(IPC.agentGrantFilesystemRoot)).resolves.toBeNull();
    expect(configStore.load().filesystem.allowedRoots).toEqual([allowedRoot]);
  });

  it('appends the chosen directory without duplicating an existing grant', async () => {
    const extra = path.join(base, 'extra');
    fs.mkdirSync(extra);
    electronState.openDialogResult = { canceled: false, filePaths: [extra] };

    const updated = (await invokeHandler(IPC.agentGrantFilesystemRoot)) as AgentConfig;
    expect(updated.filesystem.allowedRoots).toEqual([allowedRoot, extra]);

    const again = (await invokeHandler(IPC.agentGrantFilesystemRoot)) as AgentConfig;
    expect(again.filesystem.allowedRoots).toEqual([allowedRoot, extra]);
  });

  it('revokes exactly the named root', async () => {
    const updated = (await invokeHandler(IPC.agentRevokeFilesystemRoot, { path: allowedRoot })) as AgentConfig;
    expect(updated.filesystem.allowedRoots).toEqual([]);
    expect(configStore.load().filesystem.allowedRoots).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MCP clients
// ---------------------------------------------------------------------------

describe('agentCreateMcpClient', () => {
  async function createClient(name = 'Claude Desktop', tier?: string): Promise<AgentMcpClientCreated> {
    const input = tier === undefined ? { name } : { name, tier };
    return (await invokeHandler(IPC.agentCreateMcpClient, input)) as AgentMcpClientCreated;
  }

  it('stores only the token hash, never the token', async () => {
    const created = await createClient();

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created.client.tokenHash).toBe(hashMcpToken(created.token));

    const raw = fs.readFileSync(path.join(electronState.userDataPath, 'agent-config.json'), 'utf-8');
    expect(raw).not.toContain(created.token);
    expect(raw).toContain(created.client.tokenHash);
  });

  it('produces a token that verifies against the stored config exactly once', async () => {
    const created = await createClient();
    const config = configStore.load();

    expect(verifyMcpToken(config, created.token)?.id).toBe(created.client.id);
    expect(verifyMcpToken(config, `${created.token}x`)).toBeNull();
  });

  it('mints a distinct token per client', async () => {
    const first = await createClient('One');
    const second = await createClient('Two');

    expect(first.token).not.toBe(second.token);
    expect(configStore.load().mcp.clients.map((client) => client.id)).toEqual([first.client.id, second.client.id]);
  });

  it('defaults to the unrestricted tier and honours an explicit one', async () => {
    const defaultClient = await createClient('Default');
    expect(defaultClient.client.permissions).toEqual({ matrix: matrixForTier('unrestricted'), showSafetyInterlock: true });

    const readOnly = await createClient('Reader', 'read-only');
    expect(readOnly.client.permissions.matrix).toEqual(matrixForTier('read-only'));
  });

  it('returns an mcp-remote config snippet carrying the token exactly once, in env', async () => {
    const created = await createClient();
    const occurrences = created.configSnippet.split(created.token).length - 1;

    expect(occurrences).toBe(1);
    const parsed = JSON.parse(created.configSnippet) as {
      mcpServers: { lumacast: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(parsed.mcpServers.lumacast.command).toBe('npx');
    expect(parsed.mcpServers.lumacast.args).toEqual([
      '-y',
      'mcp-remote',
      // The default config port, not a placeholder — see `mcp.port`'s default
      // (a fixed port so a paste-once snippet keeps working across restarts).
      'http://127.0.0.1:43117/mcp',
      '--header',
      'Authorization:${AUTH_HEADER}',
    ]);
    expect(parsed.mcpServers.lumacast.env).toEqual({ AUTH_HEADER: `Bearer ${created.token}` });
  });

  it('falls back to the PORT placeholder when the configured port is cleared to ephemeral', async () => {
    await invokeHandler(IPC.agentUpdateConfig, { mcp: { port: null } });
    const created = await createClient();
    const parsed = JSON.parse(created.configSnippet) as { mcpServers: { lumacast: { args: string[] } } };
    expect(parsed.mcpServers.lumacast.args).toContain('http://127.0.0.1:PORT/mcp');
  });

  it('rejects a nameless client', async () => {
    await expect(invokeHandler(IPC.agentCreateMcpClient, { name: '' })).rejects.toThrow();
    await expect(invokeHandler(IPC.agentCreateMcpClient, { name: 'x', tier: 'yolo' })).rejects.toThrow();
  });
});

describe('agentRevokeMcpClient / agentUpdateMcpClientPermissions', () => {
  it('revokes one client and leaves the others', async () => {
    const first = (await invokeHandler(IPC.agentCreateMcpClient, { name: 'One' })) as AgentMcpClientCreated;
    const second = (await invokeHandler(IPC.agentCreateMcpClient, { name: 'Two' })) as AgentMcpClientCreated;

    await invokeHandler(IPC.agentRevokeMcpClient, { clientId: first.client.id });

    const clients = configStore.load().mcp.clients;
    expect(clients.map((client) => client.id)).toEqual([second.client.id]);
    expect(verifyMcpToken(configStore.load(), first.token)).toBeNull();
  });

  it('replaces one client’s permissions and rejects an unknown client id', async () => {
    const created = (await invokeHandler(IPC.agentCreateMcpClient, { name: 'One' })) as AgentMcpClientCreated;
    const permissions = { matrix: matrixForTier('unrestricted'), showSafetyInterlock: false };

    await invokeHandler(IPC.agentUpdateMcpClientPermissions, { clientId: created.client.id, permissions });
    expect(configStore.load().mcp.clients[0].permissions).toEqual(permissions);
    // The token is untouched by a permission change.
    expect(configStore.load().mcp.clients[0].tokenHash).toBe(hashMcpToken(created.token));

    await expect(
      invokeHandler(IPC.agentUpdateMcpClientPermissions, { clientId: 'nope', permissions }),
    ).rejects.toThrow(/Unknown MCP client/);
  });
});

describe('agentGetMcpStatus / agentSetMcpEnabled', () => {
  it('reports the stored preference with the host not yet running', async () => {
    expect(await invokeHandler(IPC.agentGetMcpStatus)).toEqual({
      enabled: false,
      running: false,
      port: null,
      endpoint: null,
      clients: [],
      lastError: null,
    });
  });

  it('persists the enabled flag and still reports the host as not running', async () => {
    const status = (await invokeHandler(IPC.agentSetMcpEnabled, { enabled: true })) as { enabled: boolean; running: boolean };

    expect(status).toMatchObject({ enabled: true, running: false });
    expect(configStore.load().mcp.enabled).toBe(true);
  });

  it('rejects a non-boolean enabled flag', async () => {
    await expect(invokeHandler(IPC.agentSetMcpEnabled, { enabled: 'yes' })).rejects.toThrow();
  });
});

describe('token hashing contract', () => {
  it('matches a plain sha256 hex of the token', async () => {
    const created = (await invokeHandler(IPC.agentCreateMcpClient, { name: 'One' })) as AgentMcpClientCreated;
    expect(created.client.tokenHash).toBe(crypto.createHash('sha256').update(created.token, 'utf-8').digest('hex'));
  });
});
