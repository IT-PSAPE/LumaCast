import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmProvider } from '@renderer/components/overlays/confirm-dialog';
import { createDefaultAgentConfig, matrixForTier } from '@lumacast/protocol';
import type { AgentConfig, AgentCredentialStatus, AgentMcpClient, AgentMcpStatus, AgentModelInfo } from '@lumacast/protocol';
import { AgentSettingsPanel } from '../../../../../app/renderer/screens/settings/agent-settings-panel';
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
  const config = options.config ?? baseConfig();
  const credentialStatuses = options.credentialStatuses ?? [];
  const mcpStatus = options.mcpStatus ?? baseMcpStatus();

  const api = {
    agentGetConfig: vi.fn(async () => config),
    agentUpdateConfig: vi.fn(async () => undefined),
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
    writeClipboardText: vi.fn(async () => undefined),
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
  it('renders the loaded config', async () => {
    stubCastApi({ config: baseConfig({ provider: 'anthropic', model: 'claude-3', instructions: 'Be terse.' }) });
    renderPanel();

    const providerSelect = await loaded();
    expect(within(providerSelect).getByText('Anthropic')).not.toBeNull();
    expect(screen.getByLabelText('Base URL')).not.toBeNull();
    expect(screen.getByDisplayValue('Be terse.')).not.toBeNull();
  });

  it('shows the base URL field only once a provider is selected', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: null }) });
    renderPanel();
    await loaded();
    expect(screen.queryByLabelText('Base URL')).toBeNull();

    await selectByKeyboard('Provider', 'OpenAI-compatible');

    expect(screen.getByLabelText('Base URL')).not.toBeNull();
    expect(api.agentUpdateConfig).toHaveBeenCalledWith({ provider: 'openai-compatible', model: null, baseUrl: null });
  });

  it('applies OpenCode Zen\'s default base URL when the provider is selected', async () => {
    const api = stubCastApi({ config: baseConfig({ provider: null }) });
    renderPanel();
    await loaded();

    await selectByKeyboard('Provider', 'OpenCode Zen');

    expect(screen.getByLabelText('Base URL')).toHaveValue('https://opencode.ai/zen/v1');
    expect(api.agentUpdateConfig).toHaveBeenCalledWith({
      provider: 'opencode',
      model: null,
      baseUrl: 'https://opencode.ai/zen/v1',
    });
  });

  describe('API key', () => {
    it('saves a new key and clears the input', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'anthropic' }) });
      renderPanel();
      await loaded();

      const keyInput = screen.getByLabelText('API key') as HTMLInputElement;
      fireEvent.change(keyInput, { target: { value: 'sk-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(api.agentSetCredential).toHaveBeenCalledWith({ provider: 'anthropic', apiKey: 'sk-secret' }));
      expect(keyInput.value).toBe('');
    });

    it('shows a saved key as a hint, with replace and remove', async () => {
      const api = stubCastApi({
        config: baseConfig({ provider: 'anthropic' }),
        credentialStatuses: [{ provider: 'anthropic', hasKey: true, keyHint: 'AB12' }],
      });
      renderPanel();
      await loaded();

      expect(await screen.findByText('Saved ••••AB12')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Replace' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(api.agentDeleteCredential).toHaveBeenCalledWith({ provider: 'anthropic' }));
    });

    it('surfaces a rejected save inline instead of losing the field', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'anthropic' }) });
      api.agentSetCredential.mockRejectedValueOnce(new Error('secure storage unavailable'));
      renderPanel();
      await loaded();

      fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('secure storage unavailable')).not.toBeNull();
    });
  });

  describe('Model', () => {
    it('loads models into the select and persists the chosen one', async () => {
      const models: AgentModelInfo[] = [
        { id: 'claude-a', label: 'Claude A', contextWindow: 200000, maxOutputTokens: null, supportsTools: true, isFree: false },
        { id: 'claude-b', label: 'Claude B', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
      ];
      const api = stubCastApi({ config: baseConfig({ provider: 'anthropic' }) });
      api.agentListModels.mockResolvedValueOnce(models);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await waitFor(() => expect(api.agentListModels).toHaveBeenCalledWith({ provider: 'anthropic', baseUrl: undefined }));

      await screen.findByRole('combobox', { name: 'Model' });
      await selectByKeyboard('Model', 'Claude B');

      expect(api.agentUpdateConfig).toHaveBeenCalledWith({ model: 'claude-b' });
    });

    it('sorts loaded models by display name', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels.mockResolvedValueOnce([
        { id: 'zulu', label: 'Zulu', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
        { id: 'alpha', label: 'Alpha', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
      ]);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Load models' })).toBeEnabled());
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));

      const options = await screen.findAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual(['Alpha', 'Zulu']);
    });

    it('marks free models in the picker', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels.mockResolvedValueOnce([
        { id: 'big-pickle', label: 'Big Pickle', contextWindow: 200_000, maxOutputTokens: 32_000, supportsTools: true, isFree: true },
      ]);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'Load models' })).toBeEnabled());
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
      expect(await screen.findByRole('option', { name: /Big Pickle.*Free/ })).not.toBeNull();
    });

    it('formats million-token context windows without a misleading thousands label', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels.mockResolvedValueOnce([
        { id: 'large', label: 'Large', contextWindow: 1_050_000, maxOutputTokens: null, supportsTools: true, isFree: false },
      ]);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Load models' })).toBeEnabled());
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));

      expect(await screen.findByRole('option', { name: /Large.*1\.05M context/ })).not.toBeNull();
    });

    it('shows an empty state when the provider returns no models', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels.mockResolvedValueOnce([]);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));

      expect(await screen.findByText('No models available.')).not.toBeNull();
    });

    it('shows a retry action when loading models fails', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels.mockRejectedValueOnce(new Error('Catalog unavailable'));
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
      expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    });

    it('does not show models returned for a provider that is no longer selected', async () => {
      let resolveModels: (models: AgentModelInfo[]) => void = () => {};
      const pendingModels = new Promise<AgentModelInfo[]>((resolve) => { resolveModels = resolve; });
      const api = stubCastApi({ config: baseConfig({ provider: 'anthropic' }) });
      api.agentListModels.mockReturnValueOnce(pendingModels);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      expect(screen.getByRole('button', { name: 'Loading models…' })).toBeDisabled();

      await selectByKeyboard('Provider', 'OpenCode Zen');
      resolveModels([
        { id: 'stale', label: 'Stale model', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
      ]);
      await settle();
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));

      expect(screen.queryByRole('option', { name: 'Stale model' })).toBeNull();
    });

    it('does not show models returned for a base URL that is no longer current', async () => {
      let resolveModels: (models: AgentModelInfo[]) => void = () => {};
      const pendingModels = new Promise<AgentModelInfo[]>((resolve) => { resolveModels = resolve; });
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode', baseUrl: 'https://old.example/v1' }) });
      api.agentListModels.mockReturnValueOnce(pendingModels);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://new.example/v1' } });
      fireEvent.blur(screen.getByLabelText('Base URL'));
      resolveModels([
        { id: 'stale', label: 'Stale model', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
      ]);
      await settle();
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));

      expect(api.agentUpdateConfig).toHaveBeenCalledWith({ baseUrl: 'https://new.example/v1' });
      expect(screen.queryByRole('option', { name: 'Stale model' })).toBeNull();
    });

    it('clears models from a previous successful load when refresh fails', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode' }) });
      api.agentListModels
        .mockResolvedValueOnce([
          { id: 'old', label: 'Old model', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
        ])
        .mockRejectedValueOnce(new Error('Catalog unavailable'));
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Load models' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));

      expect(screen.queryByRole('option', { name: 'Old model' })).toBeNull();
    });

    it('shows the validation chip for each outcome', async () => {
      const api = stubCastApi({ config: baseConfig({ provider: 'anthropic', model: 'claude-a' }) });
      renderPanel();
      await loaded();

      api.agentValidateModel.mockResolvedValueOnce('valid');
      fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
      expect(await screen.findByText('Valid')).not.toBeNull();

      api.agentValidateModel.mockResolvedValueOnce('not-found');
      fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
      expect(await screen.findByText('Not found')).not.toBeNull();

      api.agentValidateModel.mockResolvedValueOnce('unknown');
      fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
      expect(await screen.findByText('Unknown')).not.toBeNull();
    });

    it('ignores validation returned for a model that is no longer selected', async () => {
      let resolveValidation: (result: 'valid' | 'not-found' | 'unknown') => void = () => {};
      const pendingValidation = new Promise<'valid' | 'not-found' | 'unknown'>((resolve) => { resolveValidation = resolve; });
      const models: AgentModelInfo[] = [
        { id: 'first', label: 'First', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
        { id: 'second', label: 'Second', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false },
      ];
      const api = stubCastApi({ config: baseConfig({ provider: 'opencode', model: 'first' }) });
      api.agentListModels.mockResolvedValueOnce(models);
      api.agentValidateModel.mockReturnValueOnce(pendingValidation);
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Load models' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
      await selectByKeyboard('Model', 'Second');
      resolveValidation('valid');
      await settle();

      expect(screen.queryByText('Valid')).toBeNull();
      expect(screen.queryByText('Validating…')).toBeNull();
    });
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

    it('toggles the safety interlock checkbox', async () => {
      const api = stubCastApi({ config: baseConfig({ inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true } }) });
      renderPanel();
      await loaded();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Ask before broadcast while an output is live' }));

      await waitFor(() => expect(api.agentUpdateConfig).toHaveBeenCalledWith({
        inApp: { matrix: matrixForTier('content'), showSafetyInterlock: false },
      }));
    });
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

      await waitFor(() => expect(api.agentCreateMcpClient).toHaveBeenCalledWith({ name: 'Zapier', tier: 'read-only' }));

      expect(await screen.findByLabelText('Token')).toHaveValue('tok-123');
      expect(screen.getByText("This token won't be shown again.")).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
      expect(api.writeClipboardText).toHaveBeenCalledWith('tok-123');

      fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));
      expect(api.writeClipboardText).toHaveBeenCalledWith('{"token":"tok-123"}');

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByLabelText('Token')).toBeNull();
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
