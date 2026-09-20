import { useEffect, useState } from 'react';
import type { ActionRiskClass } from '@lumacast/commands';
import { ACTION_RISK_CLASSES } from '@lumacast/commands';
import { AGENT_PERMISSION_TIERS, matrixForTier, tierForMatrix } from '@lumacast/protocol';
import type {
  AgentConfig,
  AgentCredentialStatus,
  AgentMcpClient,
  AgentMcpStatus,
  AgentPermissionDecision,
  AgentPermissionMatrix,
  AgentPermissionTier,
} from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { FieldCheckbox, FieldInput, FieldSelect, FieldTextarea } from '@renderer/components/form/field';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { Label } from '@renderer/components/display/text';
import { AgentConnections } from './agent-connections';
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

export function AgentSettingsPanel() {
  const confirm = useConfirm();

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credentialStatuses, setCredentialStatuses] = useState<AgentCredentialStatus[]>([]);
  const [mcpStatus, setMcpStatus] = useState<AgentMcpStatus | null>(null);

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

  if (!config) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-tertiary">Loading…</p>
        {loadError ? <p role="alert" className="text-sm text-error">{loadError}</p> : null}
      </div>
    );
  }

  const currentTier = tierForMatrix(config.inApp.matrix);
  const tierValue = currentTier ?? CUSTOM_TIER;
  const clients = mcpStatus?.clients ?? [];

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
      <AgentConnections config={config} onConfig={setConfig} statuses={credentialStatuses} onStatuses={setCredentialStatuses} />

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
