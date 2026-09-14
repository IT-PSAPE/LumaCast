import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ActionRiskClass } from '@lumacast/commands';
import { ACTION_RISK_CLASSES } from '@lumacast/commands';
import { AGENT_PERMISSION_TIERS, AGENT_PROVIDERS, matrixForTier, prettifyModelId, tierForMatrix } from '@lumacast/protocol';
import type {
  AgentConfig,
  AgentCredentialStatus,
  AgentMcpClient,
  AgentMcpStatus,
  AgentModelInfo,
  AgentModelVendor,
  AgentPermissionDecision,
  AgentPermissionMatrix,
  AgentPermissionTier,
  AgentProviderId,
} from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { FieldCheckbox, FieldInput, FieldSelect, FieldTextarea } from '@renderer/components/form/field';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { Label } from '@renderer/components/display/text';
import { ModelVendorLogo } from '@renderer/features/agent/model-vendor-logo';
import { Section } from '@renderer/features/inspector/inspector-section';

const RISK_CLASS_LABELS: Record<ActionRiskClass, string> = {
  read: 'Read',
  write: 'Write',
  destructive: 'Destructive',
  broadcast: 'Broadcast',
  filesystem: 'Filesystem',
};

const CUSTOM_TIER = 'custom';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const keep = Math.floor((max - 1) / 2);
  return `${value.slice(0, keep)}…${value.slice(value.length - keep)}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 100) / 100;
    return `${millions}M context`;
  }
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k context` : `${tokens} context`;
}

interface ComposerModelRowProps {
  id: string;
  label: string;
  vendor: AgentModelVendor | null;
  isFree: boolean;
  contextWindow: number | null;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}

// A module-level memo component so toggling one row (or typing in the filter
// box, which re-renders the panel) doesn't re-render the other ~445 rows a
// loaded catalog can produce: props are primitives and `onToggle` is a
// stable callback, so React.memo's shallow comparison bails out for every
// row except the one that actually changed.
const ComposerModelRow = memo(function ComposerModelRow({ id, label, vendor, isFree, contextWindow, checked, onToggle }: ComposerModelRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-tertiary/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(id, event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded border border-primary bg-primary text-transparent transition-colors peer-checked:border-brand peer-checked:bg-brand/15 peer-checked:text-brand"
      >
        <Check size={11} strokeWidth={2.5} />
      </span>
      <ModelVendorLogo vendor={vendor} className="size-4" />
      <span className="min-w-0 flex-1 truncate text-primary">{label}</span>
      {isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
      {contextWindow != null ? <span className="shrink-0 text-tertiary">{formatContextWindow(contextWindow)}</span> : null}
    </label>
  );
});

export function AgentSettingsPanel() {
  const confirm = useConfirm();

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credentialStatuses, setCredentialStatuses] = useState<AgentCredentialStatus[]>([]);
  const [mcpStatus, setMcpStatus] = useState<AgentMcpStatus | null>(null);

  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [providerError, setProviderError] = useState<string | null>(null);

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [models, setModels] = useState<AgentModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [composerFilter, setComposerFilter] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [validation, setValidation] = useState<'valid' | 'not-found' | 'unknown' | null>(null);
  const [validating, setValidating] = useState(false);
  const modelRequestId = useRef(0);
  const validationRequestId = useRef(0);

  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [instructionsError, setInstructionsError] = useState<string | null>(null);

  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [mcpError, setMcpError] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientTier, setNewClientTier] = useState<AgentPermissionTier>('unrestricted');
  const [creatingClient, setCreatingClient] = useState(false);
  const [revealedClient, setRevealedClient] = useState<{ token: string; configSnippet: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextConfig, statuses, status] = await Promise.all([
          window.castApi.agentGetConfig(),
          window.castApi.agentGetCredentialStatus(),
          window.castApi.agentGetMcpStatus(),
        ]);
        if (cancelled) return;
        setConfig(nextConfig);
        setBaseUrlDraft(nextConfig.baseUrl ?? '');
        setInstructionsDraft(nextConfig.instructions);
        setCredentialStatuses(statuses);
        setMcpStatus(status);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => window.castApi.onAgentMcpStatus(setMcpStatus), []);

  // Lets the stable (useCallback'd) composer-row toggle handler always act on
  // the latest config without needing `config` itself as a dependency — that
  // would change identity on every commit and defeat the memoized rows below.
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  const modelOptions = models ?? [];

  const composerShortlist = useMemo(() => {
    if (!config?.provider) return [];
    return config.composerModels[config.provider] ?? [];
  }, [config?.provider, config?.composerModels]);

  // The "Model" select offers the composer shortlist rather than the whole
  // catalog (which can run to hundreds of entries) — plus the active
  // selection even when it fell outside the shortlist, so choosing a model
  // never hides what's already chosen.
  const selectableModels = useMemo(() => {
    if (composerShortlist.length === 0) return modelOptions;
    const shortlisted = modelOptions.filter((model) => composerShortlist.includes(model.id));
    const activeModelId = config?.model ?? null;
    if (activeModelId && !composerShortlist.includes(activeModelId)) {
      const activeModel = modelOptions.find((model) => model.id === activeModelId);
      if (activeModel) return [...shortlisted, activeModel];
    }
    return shortlisted;
  }, [modelOptions, composerShortlist, config?.model]);

  const modelSelectOptions = useMemo(() => (
    selectableModels.map((model) => (
      <FieldSelect.Option key={model.id} value={model.id}>
        <span className="flex min-w-0 items-center gap-1.5">
          <ModelVendorLogo vendor={model.vendor} className="size-4" />
          <span className="truncate">{model.label}</span>
          {model.isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
          {model.contextWindow != null ? <span className="shrink-0 text-tertiary">{formatContextWindow(model.contextWindow)}</span> : null}
        </span>
      </FieldSelect.Option>
    ))
  ), [selectableModels]);

  const filteredComposerModels = useMemo(() => {
    const query = composerFilter.trim().toLowerCase();
    if (query === '') return modelOptions;
    return modelOptions.filter((model) => model.label.toLowerCase().includes(query) || model.id.toLowerCase().includes(query));
  }, [modelOptions, composerFilter]);

  // Stable across renders (empty deps + ref read) so the memoized composer
  // rows below don't all re-render just because one of them toggled.
  const handleToggleComposerModel = useCallback((id: string, checked: boolean) => {
    const current = configRef.current;
    if (!current?.provider) return;
    const provider = current.provider;
    const currentIds = current.composerModels[provider] ?? [];
    const nextIds = checked ? [...currentIds, id] : currentIds.filter((existing) => existing !== id);
    const nextComposerModels = { ...current.composerModels, [provider]: nextIds };
    setConfig((prev) => (prev ? { ...prev, composerModels: nextComposerModels } : prev));
    setComposerError(null);
    window.castApi.agentUpdateConfig({ composerModels: nextComposerModels }).catch((error) => setComposerError(errorMessage(error)));
  }, []);

  if (!config) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-tertiary">Loading…</p>
        {loadError ? <p role="alert" className="text-sm text-error">{loadError}</p> : null}
      </div>
    );
  }

  const providerInfo = AGENT_PROVIDERS.find((provider) => provider.id === config.provider) ?? null;
  const credential = credentialStatuses.find((status) => status.provider === config.provider) ?? null;
  const showKeyForm = !credential?.hasKey || keyEditing;
  const currentTier = tierForMatrix(config.inApp.matrix);
  const tierValue = currentTier ?? CUSTOM_TIER;
  const hasCurrentModel = config.model ? modelOptions.some((model) => model.id === config.model) : true;
  const clients = mcpStatus?.clients ?? [];

  function handleProviderChange(value: string) {
    if (!config) return;
    const provider = (value === '' ? null : value) as AgentProviderId | null;
    const nextProviderInfo = AGENT_PROVIDERS.find((entry) => entry.id === provider) ?? null;
    const baseUrl = nextProviderInfo?.defaultBaseUrl ?? null;
    modelRequestId.current += 1;
    validationRequestId.current += 1;
    setConfig({ ...config, provider, model: null, baseUrl });
    setBaseUrlDraft(baseUrl ?? '');
    setModels(null);
    setModelsLoading(false);
    setModelsError(null);
    setComposerFilter('');
    setComposerError(null);
    setValidation(null);
    setValidating(false);
    setApiKeyDraft('');
    setKeyEditing(false);
    setKeyError(null);
    setProviderError(null);
    window.castApi.agentUpdateConfig({ provider, model: null, baseUrl }).catch((error) => setProviderError(errorMessage(error)));
  }

  function handleBaseUrlChange(value: string) {
    modelRequestId.current += 1;
    validationRequestId.current += 1;
    setBaseUrlDraft(value);
    setModels(null);
    setModelsLoading(false);
    setModelsError(null);
    setComposerFilter('');
    setComposerError(null);
    setValidation(null);
    setValidating(false);
  }

  function handleBaseUrlBlur() {
    if (!config) return;
    const trimmed = baseUrlDraft.trim();
    const nextBaseUrl = trimmed === '' ? null : trimmed;
    if (nextBaseUrl === config.baseUrl) return;
    setConfig({ ...config, baseUrl: nextBaseUrl });
    setProviderError(null);
    window.castApi.agentUpdateConfig({ baseUrl: nextBaseUrl }).catch((error) => setProviderError(errorMessage(error)));
  }

  async function handleSaveKey() {
    if (!config?.provider) return;
    const provider = config.provider;
    const apiKey = apiKeyDraft;
    // Cleared before the request settles: the key must never linger in
    // React state once the user has asked to save it.
    setApiKeyDraft('');
    setKeyError(null);
    setKeySaving(true);
    try {
      const statuses = await window.castApi.agentSetCredential({ provider, apiKey });
      setCredentialStatuses(statuses);
      setKeyEditing(false);
    } catch (error) {
      setKeyError(errorMessage(error));
    } finally {
      setKeySaving(false);
    }
  }

  async function handleRemoveKey() {
    if (!config?.provider) return;
    const provider = config.provider;
    setKeyError(null);
    try {
      const statuses = await window.castApi.agentDeleteCredential({ provider });
      setCredentialStatuses(statuses);
    } catch (error) {
      setKeyError(errorMessage(error));
    }
  }

  async function handleLoadModels() {
    if (!config?.provider) return;
    const requestId = modelRequestId.current + 1;
    modelRequestId.current = requestId;
    setModelsError(null);
    setModelsLoading(true);
    setModels(null);
    try {
      const list = await window.castApi.agentListModels({ provider: config.provider, baseUrl: config.baseUrl ?? undefined });
      if (modelRequestId.current === requestId) {
        setModels([...list].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true })));
      }
    } catch (error) {
      if (modelRequestId.current === requestId) setModelsError(errorMessage(error));
    } finally {
      if (modelRequestId.current === requestId) setModelsLoading(false);
    }
  }

  function handleModelChange(value: string) {
    if (!config) return;
    const model = value === '' ? null : value;
    setConfig({ ...config, model });
    validationRequestId.current += 1;
    setValidation(null);
    setValidating(false);
    setModelsError(null);
    window.castApi.agentUpdateConfig({ model }).catch((error) => setModelsError(errorMessage(error)));
  }

  function commitComposerModels(nextIds: string[]) {
    if (!config?.provider) return;
    const provider = config.provider;
    const nextComposerModels = { ...config.composerModels, [provider]: nextIds };
    setConfig({ ...config, composerModels: nextComposerModels });
    setComposerError(null);
    window.castApi.agentUpdateConfig({ composerModels: nextComposerModels }).catch((error) => setComposerError(errorMessage(error)));
  }

  function handleClearComposerModels() {
    commitComposerModels([]);
  }

  async function handleValidateModel() {
    if (!config?.provider || !config.model) return;
    const provider = config.provider;
    const model = config.model;
    const requestId = validationRequestId.current + 1;
    validationRequestId.current = requestId;
    setValidating(true);
    setModelsError(null);
    try {
      const result = await window.castApi.agentValidateModel({ provider, model, baseUrl: config.baseUrl ?? undefined });
      if (validationRequestId.current === requestId) setValidation(result);
    } catch (error) {
      if (validationRequestId.current === requestId) setModelsError(errorMessage(error));
    } finally {
      if (validationRequestId.current === requestId) setValidating(false);
    }
  }

  function handleInstructionsBlur() {
    if (!config || instructionsDraft === config.instructions) return;
    setConfig({ ...config, instructions: instructionsDraft });
    setInstructionsError(null);
    window.castApi.agentUpdateConfig({ instructions: instructionsDraft }).catch((error) => setInstructionsError(errorMessage(error)));
  }

  function commitInApp(matrix: AgentPermissionMatrix, showSafetyInterlock: boolean) {
    if (!config) return;
    setConfig({ ...config, inApp: { matrix, showSafetyInterlock } });
    setPermissionsError(null);
    window.castApi.agentUpdateConfig({ inApp: { matrix, showSafetyInterlock } }).catch((error) => setPermissionsError(errorMessage(error)));
  }

  function handleTierChange(value: string) {
    if (!config || value === CUSTOM_TIER) return;
    commitInApp(matrixForTier(value as AgentPermissionTier), config.inApp.showSafetyInterlock);
  }

  function handleMatrixRowChange(riskClass: ActionRiskClass, value: string | string[]) {
    if (!config || Array.isArray(value)) return;
    const nextMatrix = { ...config.inApp.matrix, [riskClass]: value as AgentPermissionDecision };
    commitInApp(nextMatrix, config.inApp.showSafetyInterlock);
  }

  function handleInterlockChange(checked: boolean) {
    if (!config) return;
    commitInApp(config.inApp.matrix, checked);
  }

  function handleInterlockValueChange(value: string | string[]) {
    // Base UI's ToggleGroup emits '' when the active segment is clicked
    // again (deselecting it); this control always has one of the two
    // segments active, so that case is a no-op.
    if (Array.isArray(value) || value === '') return;
    handleInterlockChange(value === 'yes');
  }

  async function handleAddFolder() {
    setFilesError(null);
    try {
      const next = await window.castApi.agentGrantFilesystemRoot();
      if (next) setConfig(next);
    } catch (error) {
      setFilesError(errorMessage(error));
    }
  }

  async function handleRemoveFolder(path: string) {
    setFilesError(null);
    try {
      await window.castApi.agentRevokeFilesystemRoot({ path });
      setConfig((prev) => prev ? { ...prev, filesystem: { allowedRoots: prev.filesystem.allowedRoots.filter((root) => root !== path) } } : prev);
    } catch (error) {
      setFilesError(errorMessage(error));
    }
  }

  async function refreshMcpStatus() {
    try {
      const status = await window.castApi.agentGetMcpStatus();
      setMcpStatus(status);
    } catch (error) {
      setMcpError(errorMessage(error));
    }
  }

  function handleMcpEnabledChange(checked: boolean) {
    setMcpStatus((prev) => prev ? { ...prev, enabled: checked } : prev);
    setMcpError(null);
    window.castApi.agentSetMcpEnabled({ enabled: checked }).then(setMcpStatus).catch((error) => setMcpError(errorMessage(error)));
  }

  function handleClientTierChange(client: AgentMcpClient, value: string) {
    if (value === CUSTOM_TIER) return;
    const permissions = { matrix: matrixForTier(value as AgentPermissionTier), showSafetyInterlock: client.permissions.showSafetyInterlock };
    setMcpError(null);
    window.castApi.agentUpdateMcpClientPermissions({ clientId: client.id, permissions })
      .then(setMcpStatus)
      .catch((error) => setMcpError(errorMessage(error)));
  }

  async function handleRevokeClient(client: AgentMcpClient) {
    const confirmed = await confirm({
      title: `Revoke ${client.name}?`,
      description: 'This client loses access immediately and must be reconnected with a new token.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) return;
    setMcpError(null);
    try {
      const status = await window.castApi.agentRevokeMcpClient({ clientId: client.id });
      setMcpStatus(status);
    } catch (error) {
      setMcpError(errorMessage(error));
    }
  }

  async function handleCreateClient() {
    const name = newClientName.trim();
    if (!name) return;
    setMcpError(null);
    setCreatingClient(true);
    try {
      const result = await window.castApi.agentCreateMcpClient({ name, tier: newClientTier });
      setRevealedClient({ token: result.token, configSnippet: result.configSnippet });
      setAddingClient(false);
      setNewClientName('');
      await refreshMcpStatus();
    } catch (error) {
      setMcpError(errorMessage(error));
    } finally {
      setCreatingClient(false);
    }
  }

  function handleCopyToken() {
    if (revealedClient) void window.castApi.writeClipboardText(revealedClient.token);
  }

  function handleCopyConfig() {
    if (revealedClient) void window.castApi.writeClipboardText(revealedClient.configSnippet);
  }

  function handleCopyMcpSetup() {
    if (!config) return;
    const endpoint = mcpStatus?.endpoint ?? `http://127.0.0.1:${config.mcp.port ?? 'PORT'}/mcp`;
    const token = revealedClient?.token ?? '<token>';
    void window.castApi.writeClipboardText(buildMcpSetupInstructions({ endpoint, token }));
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section.Root>
        <Section.Header><Label.xs>Connection</Label.xs></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <FieldSelect value={config.provider ?? ''} onChange={handleProviderChange} label="Provider">
              {AGENT_PROVIDERS.map((provider) => (
                <FieldSelect.Option key={provider.id} value={provider.id}>{provider.label}</FieldSelect.Option>
              ))}
            </FieldSelect>

            {providerInfo ? (
              <FieldInput
                label="Base URL"
                value={baseUrlDraft}
                onChange={handleBaseUrlChange}
                onBlur={handleBaseUrlBlur}
                placeholder={providerInfo.defaultBaseUrl ?? undefined}
              />
            ) : null}
          </div>

          {providerInfo ? (
            <div className="flex flex-col gap-1.5">
              {showKeyForm ? (
                <div className="flex items-center gap-2">
                  <FieldInput
                    type="password"
                    value={apiKeyDraft}
                    onChange={setApiKeyDraft}
                    placeholder="API key"
                    ariaLabel="API key"
                    wrapperClassName="flex-1"
                  />
                  <ReacstButton onClick={() => void handleSaveKey()} disabled={!apiKeyDraft || keySaving}>
                    {keySaving ? 'Saving…' : 'Save'}
                  </ReacstButton>
                  {credential?.hasKey ? (
                    <ReacstButton variant="ghost" onClick={() => { setKeyEditing(false); setApiKeyDraft(''); setKeyError(null); }}>
                      Cancel
                    </ReacstButton>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-secondary">{`Saved ••••${credential?.keyHint ?? ''}`}</span>
                  <ReacstButton onClick={() => setKeyEditing(true)}>Replace</ReacstButton>
                  <ReacstButton variant="danger" onClick={() => void handleRemoveKey()}>Remove</ReacstButton>
                </div>
              )}
              {keyError ? <p role="alert" className="text-sm text-error">{keyError}</p> : null}
            </div>
          ) : null}

          {providerError ? <p role="alert" className="text-sm text-error">{providerError}</p> : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Assistant model</Label.xs></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <FieldSelect value={config.model ?? ''} onChange={handleModelChange} label="Model">
              {modelSelectOptions}
              {config.model && !hasCurrentModel ? <FieldSelect.Option value={config.model}>{prettifyModelId(config.model)}</FieldSelect.Option> : null}
            </FieldSelect>
            <ReacstButton onClick={() => void handleLoadModels()} disabled={!config.provider || modelsLoading}>
              {modelsLoading ? 'Loading models…' : modelsError ? 'Retry' : 'Load models'}
            </ReacstButton>
          </div>

          {models && models.length === 0 && !modelsLoading && !modelsError ? (
            <p className="text-sm text-tertiary">No models available.</p>
          ) : null}

          {config.provider ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Label.xs>Composer models</Label.xs>
                  {composerShortlist.length > 0 ? (
                    <span className="rounded-sm bg-tertiary px-1.5 py-0.5 text-[10px]">{composerShortlist.length} selected</span>
                  ) : null}
                </div>
                {composerShortlist.length > 0 ? (
                  <ReacstButton variant="ghost" onClick={handleClearComposerModels}>Clear</ReacstButton>
                ) : null}
              </div>

              {models === null ? (
                composerShortlist.length === 0 ? (
                  <p className="text-sm text-tertiary">All models</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {composerShortlist.map((id) => (
                      <li key={id} className="flex items-center justify-between gap-2 rounded bg-tertiary/60 px-2 py-1">
                        <span className="min-w-0 truncate text-sm text-secondary">{prettifyModelId(id)}</span>
                        <ReacstButton.Icon
                          label={`Remove ${prettifyModelId(id)}`}
                          variant="ghost"
                          onClick={() => handleToggleComposerModel(id, false)}
                        >
                          <X size={12} />
                        </ReacstButton.Icon>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <FieldInput value={composerFilter} onChange={setComposerFilter} placeholder="Filter models" ariaLabel="Filter models" />
                  <div className="max-h-64 overflow-y-auto rounded border border-secondary">
                    {filteredComposerModels.length === 0 ? (
                      <p className="px-2 py-1.5 text-sm text-tertiary">No matches</p>
                    ) : (
                      filteredComposerModels.map((model) => (
                        <ComposerModelRow
                          key={model.id}
                          id={model.id}
                          label={model.label}
                          vendor={model.vendor}
                          isFree={model.isFree}
                          contextWindow={model.contextWindow}
                          checked={composerShortlist.includes(model.id)}
                          onToggle={handleToggleComposerModel}
                        />
                      ))
                    )}
                  </div>
                </>
              )}

              {composerError ? <p role="alert" className="text-sm text-error">{composerError}</p> : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <ReacstButton onClick={() => void handleValidateModel()} disabled={!config.model || validating}>
              Validate
            </ReacstButton>
            {validating ? <span className="text-sm text-tertiary">Validating…</span> : null}
            {!validating && validation === 'valid' ? <span className="text-sm text-success">Valid</span> : null}
            {!validating && validation === 'not-found' ? <span className="text-sm text-error">Not found</span> : null}
            {!validating && validation === 'unknown' ? <span className="text-sm text-tertiary">Unknown</span> : null}
          </div>

          {modelsError ? <p role="alert" className="text-sm text-error">{modelsError}</p> : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Custom instructions</Label.xs></Section.Header>
        <Section.Body>
          <FieldTextarea
            value={instructionsDraft}
            onChange={setInstructionsDraft}
            onBlur={handleInstructionsBlur}
            placeholder="e.g. Keep playlist names in Title Case."
            rows={6}
          />
          {instructionsError ? <p role="alert" className="text-sm text-error">{instructionsError}</p> : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Permissions</Label.xs></Section.Header>
        <Section.Body>
          <FieldSelect value={tierValue} onChange={handleTierChange} label="Permission tier">
            {AGENT_PERMISSION_TIERS.map((tier) => (
              <FieldSelect.Option key={tier.id} value={tier.id}>{tier.label}</FieldSelect.Option>
            ))}
            {currentTier === null ? <FieldSelect.Option value={CUSTOM_TIER}>Custom</FieldSelect.Option> : null}
          </FieldSelect>

          <div className="flex flex-col gap-2">
            {ACTION_RISK_CLASSES.map((riskClass) => (
              <div key={riskClass} className="flex items-center justify-between gap-3">
                <span className="text-sm text-secondary">{RISK_CLASS_LABELS[riskClass]}</span>
                <SegmentedControl
                  value={config.inApp.matrix[riskClass]}
                  onValueChange={(value) => handleMatrixRowChange(riskClass, value)}
                  aria-label={`${RISK_CLASS_LABELS[riskClass]} permission`}
                  fill
                  className="w-44"
                >
                  <SegmentedControl.Label value={'auto' satisfies AgentPermissionDecision} fill>Auto</SegmentedControl.Label>
                  <SegmentedControl.Label value={'ask' satisfies AgentPermissionDecision} fill>Ask</SegmentedControl.Label>
                  <SegmentedControl.Label value={'deny' satisfies AgentPermissionDecision} fill>Deny</SegmentedControl.Label>
                </SegmentedControl>
              </div>
            ))}

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-secondary">Ask before broadcast while an output is live</span>
              <SegmentedControl
                value={config.inApp.showSafetyInterlock ? 'yes' : 'no'}
                onValueChange={handleInterlockValueChange}
                aria-label="Ask before broadcast while an output is live"
                fill
                className="w-44"
              >
                <SegmentedControl.Label value="yes" fill>Yes</SegmentedControl.Label>
                <SegmentedControl.Label value="no" fill>No</SegmentedControl.Label>
              </SegmentedControl>
            </div>
          </div>

          {permissionsError ? <p role="alert" className="text-sm text-error">{permissionsError}</p> : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Folders the assistant can read</Label.xs></Section.Header>
        <Section.Body>
          {config.filesystem.allowedRoots.length === 0 ? (
            <p className="text-sm text-tertiary">No folders granted.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {config.filesystem.allowedRoots.map((path) => (
                <li key={path} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-sm text-secondary" title={path}>{truncateMiddle(path)}</span>
                  <ReacstButton variant="danger" onClick={() => void handleRemoveFolder(path)}>Remove</ReacstButton>
                </li>
              ))}
            </ul>
          )}
          <ReacstButton onClick={() => void handleAddFolder()}>Add folder…</ReacstButton>
          {filesError ? <p role="alert" className="text-sm text-error">{filesError}</p> : null}
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <div className="flex w-full items-center justify-between">
            <Label.xs>MCP server</Label.xs>
            <ReacstButton variant="ghost" onClick={handleCopyMcpSetup}>Copy setup</ReacstButton>
          </div>
        </Section.Header>
        <Section.Body>
          <FieldCheckbox checked={mcpStatus?.enabled ?? false} onChange={handleMcpEnabledChange} label="Enable MCP server" />

          <p className="text-sm text-secondary">{mcpStatus?.running ? `Running on ${mcpStatus.endpoint}` : 'Stopped'}</p>
          {mcpStatus?.lastError ? <p role="alert" className="text-sm text-error">{mcpStatus.lastError}</p> : null}

          {clients.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-tertiary">
                  <th className="py-1 font-normal">Name</th>
                  <th className="py-1 font-normal">Tier</th>
                  <th className="py-1 font-normal">Created</th>
                  <th className="py-1 font-normal">Last seen</th>
                  <th className="py-1 font-normal" />
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const clientTier = tierForMatrix(client.permissions.matrix);
                  return (
                    <tr key={client.id} className="border-t border-secondary" data-testid={`mcp-client-${client.id}`}>
                      <td className="py-1.5 text-primary">{client.name}</td>
                      <td className="py-1.5">
                        <FieldSelect value={clientTier ?? CUSTOM_TIER} onChange={(value) => handleClientTierChange(client, value)}>
                          {AGENT_PERMISSION_TIERS.map((tier) => (
                            <FieldSelect.Option key={tier.id} value={tier.id}>{tier.label}</FieldSelect.Option>
                          ))}
                          {clientTier === null ? <FieldSelect.Option value={CUSTOM_TIER}>Custom</FieldSelect.Option> : null}
                        </FieldSelect>
                      </td>
                      <td className="py-1.5 text-secondary">{formatTimestamp(client.createdAt)}</td>
                      <td className="py-1.5 text-secondary">{client.lastSeenAt ? formatTimestamp(client.lastSeenAt) : 'Never'}</td>
                      <td className="py-1.5 text-right">
                        <ReacstButton variant="danger" onClick={() => void handleRevokeClient(client)}>Revoke</ReacstButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          {revealedClient ? (
            <div className="flex flex-col gap-2 rounded border border-primary p-3">
              <FieldInput label="Token" value={revealedClient.token} onChange={() => undefined} disabled inputClassName="font-mono" />
              <p className="text-sm text-tertiary">This token won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <ReacstButton onClick={handleCopyToken}>Copy token</ReacstButton>
                <ReacstButton onClick={handleCopyConfig}>Copy config</ReacstButton>
                <ReacstButton variant="ghost" onClick={() => setRevealedClient(null)}>Done</ReacstButton>
              </div>
            </div>
          ) : addingClient ? (
            <div className="flex items-center gap-2">
              <FieldInput value={newClientName} onChange={setNewClientName} placeholder="Client name" ariaLabel="Client name" wrapperClassName="flex-1" />
              <FieldSelect value={newClientTier} onChange={(value) => setNewClientTier(value as AgentPermissionTier)}>
                {AGENT_PERMISSION_TIERS.map((tier) => (
                  <FieldSelect.Option key={tier.id} value={tier.id}>{tier.label}</FieldSelect.Option>
                ))}
              </FieldSelect>
              <ReacstButton onClick={() => void handleCreateClient()} disabled={!newClientName.trim() || creatingClient}>
                {creatingClient ? 'Creating…' : 'Create'}
              </ReacstButton>
              <ReacstButton variant="ghost" onClick={() => { setAddingClient(false); setNewClientName(''); }}>Cancel</ReacstButton>
            </div>
          ) : (
            <ReacstButton onClick={() => setAddingClient(true)}>Add client</ReacstButton>
          )}

          {mcpError ? <p role="alert" className="text-sm text-error">{mcpError}</p> : null}
        </Section.Body>
      </Section.Root>
    </div>
  );
}

/** The plain-text setup instructions "Copy setup" places on the clipboard. Exported for its own unit test. */
export function buildMcpSetupInstructions({ endpoint, token }: { endpoint: string; token: string }): string {
  return `LumaCast MCP server

Endpoint: ${endpoint}  (MCP Streamable HTTP; loopback only — the client must run on this Mac, and LumaCast must be open)
Auth: Authorization: Bearer ${token}
Create a client under Settings → Assistant → MCP server; its token is shown once. New clients are unrestricted by default; change the tier per client.

Claude Code:
claude mcp add --transport http lumacast ${endpoint} --header "Authorization: Bearer ${token}"

Claude Desktop / Cursor / any stdio-only client (mcpServers entry):
{
  "lumacast": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "${endpoint}", "--header", "Authorization:\${AUTH_HEADER}"],
    "env": { "AUTH_HEADER": "Bearer ${token}" }
  }
}

Clients with native HTTP MCP support: URL ${endpoint}, header Authorization: Bearer ${token}.`;
}
