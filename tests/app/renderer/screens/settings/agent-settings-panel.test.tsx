import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmProvider } from '@renderer/components/overlays/confirm-dialog';
import { createDefaultAgentConfig, matrixForTier } from '@lumacast/protocol';
import type { AgentConfig, AgentConfigUpdate, AgentCredentialStatus, AgentMcpClient, AgentMcpStatus, AgentModelInfo } from '@lumacast/protocol';
import { AgentSettingsPanel, buildMcpSetupInstructions } from '../../../../../app/renderer/screens/settings/agent-settings-panel';
import { overlayRoot, overlayStackStore } from '../../components/overlays/workbench-overlay-stack';

// FieldSelect and the confirm dialog both read the workbench overlay stack;
// this stands in for the real provider the same way confirm-dialog.test.tsx does.
vi.mock('@renderer/contexts/workbench-context', () => import('../../components/overlays/workbench-overlay-stack'));

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { ...createDefaultAgentConfig(), ...overrides };
}

function baseMcpStatus(overrides: Partial<AgentMcpStatus> = {}): AgentMcpStatus {
  return {
    enabled: false,
    running: false,
    port: null,
    endpoint: null,
    clients: [],
    lastError: null,
    ...overrides,
  };
}

function makeClient(overrides: Partial<AgentMcpClient> = {}): AgentMcpClient {
  return {
    id: 'client-1',
    name: 'Zapier',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    permissions: { matrix: matrixForTier('read-only'), showSafetyInterlock: true },
    tokenHash: 'hash',
    ...overrides,
  };
}

function stubCastApi(options: {
  config?: AgentConfig;
  credentialStatuses?: AgentCredentialStatus[];
  mcpStatus?: AgentMcpStatus;
} = {}) {
  let config = options.config ?? baseConfig();
  const credentialStatuses = options.credentialStatuses ?? [];
  const mcpStatus = options.mcpStatus ?? baseMcpStatus();

  const api = {
    agentGetConfig: vi.fn(async () => config),
    agentUpdateConfig: vi.fn(async (patch: AgentConfigUpdate) => {
      config = { ...config, ...patch, providerBaseUrls: { ...config.providerBaseUrls, ...patch.providerBaseUrls }, mcp: { ...config.mcp, ...patch.mcp } };
      return config;
    }),
    agentGetCredentialStatus: vi.fn(async () => credentialStatuses),
    agentSetCredential: vi.fn(async () => credentialStatuses),
    agentDeleteCredential: vi.fn(async () => credentialStatuses),
    agentListModels: vi.fn(async () => [] as AgentModelInfo[]),
    agentValidateModel: vi.fn(async (): Promise<'valid' | 'not-found' | 'unknown'> => 'unknown'),
    agentGrantFilesystemRoot: vi.fn(async () => null as AgentConfig | null),
    agentRevokeFilesystemRoot: vi.fn(async () => undefined),
    agentGetMcpStatus: vi.fn(async () => mcpStatus),
    agentSetMcpEnabled: vi.fn(async (input: { enabled: boolean }) => ({ ...mcpStatus, enabled: input.enabled })),
    agentCreateMcpClient: vi.fn(async () => ({ client: makeClient(), token: 'secret-token', configSnippet: '{"token":"secret-token"}' })),
    agentRevokeMcpClient: vi.fn(async () => mcpStatus),
    agentUpdateMcpClientPermissions: vi.fn(async () => mcpStatus),
    onAgentMcpStatus: vi.fn((_callback: (status: AgentMcpStatus) => void) => () => undefined),
    writeClipboardText: vi.fn(async (_text: string) => undefined),
  };

  Object.defineProperty(window, 'castApi', { configurable: true, value: api });
  return api;
}

function renderPanel() {
  return render(
    <ConfirmProvider>
      <AgentSettingsPanel />
    </ConfirmProvider>,
  );
}

// Base UI's Select settles its floating position/open state asynchronously;
// a subsequent interaction needs a tick for that to land (mirrors field.test.tsx).
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

// Selecting a Base UI Select option by simulated pointer click is flaky under
// jsdom (see field.test.tsx's own "opens and selects a composed option..."
// case, which fails the same way independent of this file). Keyboard
// navigation is the reliable path its other, passing tests use.
async function selectByKeyboard(comboboxName: string, optionName: string) {
  const trigger = screen.getByRole('combobox', { name: comboboxName });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await settle();

  for (let i = 0; i < 20; i += 1) {
    const option = screen.getByRole('option', { name: optionName });
    if (option.getAttribute('data-highlighted') !== null) break;
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'ArrowDown' });
    await settle();
  }

  fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Enter' });
  await settle();
}

async function loaded() {
  return screen.findByRole('combobox', { name: 'Provider' });
}

afterEach(() => {
  cleanup();
  overlayStackStore.reset();
  overlayRoot().replaceChildren();
});

describe('AgentSettingsPanel', () => {
  it('renders independent provider connections and automatically loads their catalogs', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: 'openrouter', model: 'saved', instructions: 'Be terse.' }), credentialStatuses: [
      { provider: 'openrouter', hasKey: true, keyHint: 'rout' }, { provider: 'openai', hasKey: true, keyHint: 'oaik' },
    ] });
    renderPanel();
    expect(await screen.findByRole('group', { name: 'OpenRouter connection' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'OpenAI connection' })).toBeInTheDocument();
    await waitFor(() => expect(api.agentListModels).toHaveBeenCalledTimes(2));
    expect(screen.getByDisplayValue('Be terse.')).toBeInTheDocument();
    expect(screen.queryByText('Load models')).toBeNull();
  });

  it('adds a provider without changing the default or removing an existing key', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: 'openrouter', model: 'saved' }), credentialStatuses: [{ provider: 'openrouter', hasKey: true, keyHint: 'rout' }] });
    api.agentSetCredential.mockResolvedValue([{ provider: 'openrouter', hasKey: true, keyHint: 'rout' }, { provider: 'anthropic', hasKey: true, keyHint: 'new1' }]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add connection' }));
    const row = screen.getByRole('group', { name: 'Anthropic connection' });
    const input = within(row).getByLabelText('Anthropic API key');
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.change(input, { target: { value: 'new-secret' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.agentSetCredential).toHaveBeenCalledWith({ provider: 'anthropic', apiKey: 'new-secret' }));
    expect(api.agentDeleteCredential).not.toHaveBeenCalled();
    expect(api.agentUpdateConfig).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('new-secret')).toBeNull();
  });

  it('keeps saved keys masked and allows cancelling a replacement', async () => {
    stubCastApi({ credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: '1234' }] });
    renderPanel();
    const input = await screen.findByLabelText('Anthropic API key');
    expect(input).toHaveAttribute('placeholder', '••••1234');
    fireEvent.change(input, { target: { value: 'replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', '••••1234');
  });

  it('removes only the requested provider', async () => {
    const api = stubCastApi({ credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }, { provider: 'openrouter', hasKey: true, keyHint: 'r123' }] });
    api.agentDeleteCredential.mockResolvedValue([{ provider: 'openrouter', hasKey: true, keyHint: 'r123' }]);
    renderPanel();
    const row = await screen.findByRole('group', { name: 'Anthropic connection' });
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.agentDeleteCredential).toHaveBeenCalledWith({ provider: 'anthropic' }));
    expect(screen.getByRole('group', { name: 'OpenRouter connection' })).toBeInTheDocument();
  });

  it('reports a rejected key save and clears the secret draft', async () => {
    const api = stubCastApi();
    api.agentSetCredential.mockRejectedValue(new Error('Keychain unavailable'));
    renderPanel();
    const input = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Keychain unavailable')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('persists custom URLs per provider without switching the assistant default', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: 'openrouter', model: 'saved' }), credentialStatuses: [{ provider: 'openrouter', hasKey: true, keyHint: 'r123' }, { provider: 'opencode', hasKey: true, keyHint: 'z123' }] });
    renderPanel();
    const row = await screen.findByRole('group', { name: 'OpenCode Zen connection' });
    fireEvent.change(within(row).getByLabelText('OpenCode Zen base URL'), { target: { value: 'https://custom.test/v1' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({ providerBaseUrls: { opencode: 'https://custom.test/v1' } }));
  });

  it('supports legacy configs without composerModels and keeps model selection visible', async () => {
    const config = baseConfig({ provider: 'anthropic', model: 'model-a' });
    delete (config as Partial<AgentConfig>).composerModels;
    const api = stubCastApi({ config, credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }] });
    api.agentListModels.mockResolvedValue([{ id: 'model-a', label: 'Model A', vendor: 'anthropic', isFree: false, contextWindow: null, maxOutputTokens: null, supportsTools: true }]);
    renderPanel();
    expect(await screen.findByRole('combobox', { name: 'Anthropic default model' })).toBeInTheDocument();
    const box = await screen.findByRole('checkbox', { name: 'Model A' });
    fireEvent.click(box);
    await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({ composerModels: { anthropic: ['model-a'] } }));
    expect(screen.getByRole('combobox', { name: 'Anthropic default model' })).toBeInTheDocument();
  });

  it('makes saved shortlisted models available before an offline catalog resolves', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: 'anthropic', model: 'model-a', composerModels: { anthropic: ['model-a', 'model-b'] } }), credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }] });
    api.agentListModels.mockRejectedValue(new Error('offline'));
    renderPanel();
    expect(await screen.findByRole('checkbox', { name: 'Model B' })).toBeInTheDocument();
    await selectByKeyboard('Anthropic default model', 'Model B');
    await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({ provider: 'anthropic', model: 'model-b' }));
    expect(screen.getByRole('group', { name: 'Anthropic models' })).toBeInTheDocument();
  });

  it('preserves a successful catalog when explicit refresh fails', async () => {
    const api = stubCastApi({ credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }] });
    api.agentListModels.mockResolvedValueOnce([{ id: 'model-a', label: 'Model A', vendor: null, isFree: false, contextWindow: null, maxOutputTokens: null, supportsTools: true }]).mockRejectedValueOnce(new Error('offline'));
    renderPanel();
    expect(await screen.findByRole('checkbox', { name: 'Model A' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Model A' })).toBeInTheDocument();
    expect(api.agentListModels).toHaveBeenLastCalledWith({ provider: 'anthropic', baseUrl: null, refresh: true });
  });

  it('ignores a removed provider catalog that resolves late', async () => {
    const api = stubCastApi({ credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }] });
    let resolve!: (models: AgentModelInfo[]) => void;
    api.agentListModels.mockReturnValue(new Promise((done) => { resolve = done; }));
    api.agentDeleteCredential.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(within(await screen.findByRole('group', { name: 'Anthropic connection' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Anthropic models' })).toBeNull());
    await act(async () => resolve([{ id: 'late', label: 'Late model', vendor: null, isFree: false, contextWindow: null, maxOutputTokens: null, supportsTools: true }]));
    expect(screen.queryByText('Late model')).toBeNull();
  });

  it('preserves other provider shortlists and serializes quick checkbox changes', async () => {
    const api = stubCastApi({ config: baseConfig({ composerModels: { anthropic: ['model-a', 'model-b'], openrouter: ['saved'] } }), credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'a123' }] });
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Model A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model B' }));
    await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenLastCalledWith({ composerModels: { anthropic: [], openrouter: ['saved'] } }));
  });

  it('saves instructions on blur', async () => {
    const api = stubCastApi({ config: baseConfig({ instructions: 'Old.' }) });
    renderPanel();
    await loaded();

    const textarea = screen.getByDisplayValue('Old.');
    fireEvent.change(textarea, { target: { value: 'New instructions.' } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({ instructions: 'New instructions.' }));
  });

  it('labels the instructions section "Custom instructions" with an example placeholder', async () => {
    stubCastApi({ config: baseConfig({ instructions: '' }) });
    renderPanel();
    await loaded();

    expect(await screen.findByText('Custom instructions')).not.toBeNull();
    expect(screen.getByPlaceholderText('e.g. Keep playlist names in Title Case.')).not.toBeNull();
  });

  describe('Permissions', () => {
    it('applies a tier matrix when a tier is chosen', async () => {
      const api = stubCastApi({ config: baseConfig({ inApp: { matrix: matrixForTier('off'), showSafetyInterlock: true } }) });
      renderPanel();
      await loaded();

      await selectByKeyboard('Permission tier', 'Content');

      expect(api.agentUpdateConfig).toHaveBeenCalledWith({ inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true } });
    });

    it('derives "Custom" once a row diverges from every tier', async () => {
      const api = stubCastApi({ config: baseConfig({ inApp: { matrix: matrixForTier('read-only'), showSafetyInterlock: true } }) });
      renderPanel();
      await loaded();

      const writeGroup = screen.getByRole('group', { name: 'Write permission' });
      fireEvent.click(within(writeGroup).getByRole('button', { name: 'Ask' }));

      const tierSelect = screen.getByRole('combobox', { name: 'Permission tier' });
      expect(within(tierSelect).getByText('Custom')).not.toBeNull();
      expect(api.agentUpdateConfig).toHaveBeenCalledWith({
        inApp: { matrix: { ...matrixForTier('read-only'), write: 'ask' }, showSafetyInterlock: true },
      });
    });

    it('toggles the safety interlock segmented control', async () => {
      const api = stubCastApi({ config: baseConfig({ inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true } }) });
      renderPanel();
      await loaded();

      const interlockGroup = screen.getByRole('group', { name: 'Ask before broadcast while an output is live' });
      fireEvent.click(within(interlockGroup).getByRole('button', { name: 'No' }));

      await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({
        inApp: { matrix: matrixForTier('content'), showSafetyInterlock: false },
      }));
    });
  });

  it('labels the files section "Folders the assistant can read"', async () => {
    stubCastApi({ config: baseConfig({ filesystem: { allowedRoots: [] } }) });
    renderPanel();
    await loaded();

    expect(await screen.findByText('Folders the assistant can read')).not.toBeNull();
  });

  it('shows the empty state, then adds and removes a folder', async () => {
    const api = stubCastApi({ config: baseConfig({ filesystem: { allowedRoots: [] } }) });
    renderPanel();
    await loaded();
    expect(screen.getByText('No folders granted.')).not.toBeNull();

    api.agentGrantFilesystemRoot.mockResolvedValueOnce(baseConfig({ filesystem: { allowedRoots: ['/Users/nico/Documents'] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    expect(await screen.findByText('/Users/nico/Documents')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.agentRevokeFilesystemRoot).toHaveBeenCalledWith({ path: '/Users/nico/Documents' }));
    expect(await screen.findByText('No folders granted.')).not.toBeNull();
  });

  describe('MCP server', () => {
    it('enables the server', async () => {
      const api = stubCastApi({ mcpStatus: baseMcpStatus({ enabled: false, running: false }) });
      renderPanel();
      await loaded();

      const checkbox = screen.getByRole('checkbox', { name: 'Enable MCP server' });
      fireEvent.click(checkbox);

      await waitFor(() => expect(api.agentSetMcpEnabled).toHaveBeenCalledWith({ enabled: true }));
      expect(checkbox).toHaveAttribute('aria-checked', 'true');
    });

    it('creates a client, reveals the token once, and copies it', async () => {
      const api = stubCastApi();
      api.agentCreateMcpClient.mockResolvedValueOnce({
        client: makeClient({ id: 'c-2', name: 'Zapier' }),
        token: 'tok-123',
        configSnippet: '{"token":"tok-123"}',
      });
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Add client' }));
      fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Zapier' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.agentCreateMcpClient).toHaveBeenCalledWith({ name: 'Zapier', tier: 'unrestricted' }));

      expect(await screen.findByLabelText('Token')).toHaveValue('tok-123');
      expect(screen.getByText("This token won't be shown again.")).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
      expect(api.writeClipboardText).toHaveBeenCalledWith('tok-123');

      fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));
      expect(api.writeClipboardText).toHaveBeenCalledWith('{"token":"tok-123"}');

      fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));
      const setupText = api.writeClipboardText.mock.calls.at(-1)?.[0] as string;
      expect(setupText).toContain('Bearer tok-123');
      expect(setupText).not.toContain('<token>');

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByLabelText('Token')).toBeNull();
    });

    it('copies MCP setup instructions with a placeholder token before any client is revealed', async () => {
      const api = stubCastApi({ mcpStatus: baseMcpStatus({ enabled: true, running: true, endpoint: 'http://127.0.0.1:43117/mcp' }) });
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

      expect(api.writeClipboardText).toHaveBeenCalledTimes(1);
      const setupText = api.writeClipboardText.mock.calls[0][0] as string;
      expect(setupText).toContain('http://127.0.0.1:43117/mcp');
      expect(setupText).toContain('Bearer <token>');
      expect(setupText).toContain('claude mcp add');
    });

    it('revokes a client only after confirming', async () => {
      const client = makeClient({ id: 'c-1', name: 'Zapier' });
      const api = stubCastApi({ mcpStatus: baseMcpStatus({ clients: [client] }) });
      api.agentRevokeMcpClient.mockResolvedValueOnce(baseMcpStatus({ clients: [] }));
      renderPanel();
      await loaded();

      const row = await screen.findByTestId('mcp-client-c-1');
      fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));

      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      await waitFor(() => expect(api.agentRevokeMcpClient).toHaveBeenCalledWith({ clientId: 'c-1' }));
      await waitFor(() => expect(screen.queryByTestId('mcp-client-c-1')).toBeNull());
    });

    it('reflects live status pushed via onAgentMcpStatus', async () => {
      let pushStatus: ((status: AgentMcpStatus) => void) | null = null;
      const api = stubCastApi({ mcpStatus: baseMcpStatus({ running: false }) });
      api.onAgentMcpStatus.mockImplementation((callback: (status: AgentMcpStatus) => void) => {
        pushStatus = callback;
        return () => undefined;
      });
      renderPanel();
      await loaded();
      expect(screen.getByText('Stopped')).not.toBeNull();

      act(() => {
        pushStatus?.(baseMcpStatus({ running: true, endpoint: 'http://localhost:4000' }));
      });

      expect(await screen.findByText('Running on http://localhost:4000')).not.toBeNull();
    });
  });
});

describe('buildMcpSetupInstructions', () => {
  it('substitutes the endpoint and token into every occurrence', () => {
    const text = buildMcpSetupInstructions({ endpoint: 'http://127.0.0.1:43117/mcp', token: 'tok-abc' });

    expect(text).toBe(`LumaCast MCP server

Endpoint: http://127.0.0.1:43117/mcp  (MCP Streamable HTTP; loopback only — the client must run on this Mac, and LumaCast must be open)
Auth: Authorization: Bearer tok-abc
Create a client under Settings → Assistant → MCP server; its token is shown once. New clients are unrestricted by default; change the tier per client.

Claude Code:
claude mcp add --transport http lumacast http://127.0.0.1:43117/mcp --header "Authorization: Bearer tok-abc"

Claude Desktop / Cursor / any stdio-only client (mcpServers entry):
{
  "lumacast": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "http://127.0.0.1:43117/mcp", "--header", "Authorization:\${AUTH_HEADER}"],
    "env": { "AUTH_HEADER": "Bearer tok-abc" }
  }
}

Clients with native HTTP MCP support: URL http://127.0.0.1:43117/mcp, header Authorization: Bearer tok-abc.`);
  });
});
