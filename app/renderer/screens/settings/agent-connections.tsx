import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { AGENT_PROVIDERS, agentProviderBaseUrl, inferModelVendor, prettifyModelId } from '@lumacast/protocol';
import type { AgentConfig, AgentConfigUpdate, AgentCredentialStatus, AgentModelInfo, AgentProviderId } from '@lumacast/protocol';
import { ReacstButton } from '@renderer/components/controls/button';
import { FieldInput, FieldSelect } from '@renderer/components/form/field';
import { Label } from '@renderer/components/display/text';
import { ModelVendorLogo } from '@renderer/features/agent/model-vendor-logo';
import { Section } from '@renderer/features/inspector/inspector-section';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Commit = (patch: AgentConfigUpdate) => Promise<void>;

export function AgentConnections({ config, onConfig, statuses, onStatuses }: {
  config: AgentConfig; onConfig: (config: AgentConfig) => void;
  statuses: AgentCredentialStatus[]; onStatuses: (statuses: AgentCredentialStatus[]) => void;
}) {
  const current = useRef(config);
  current.current = config;
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const [adding, setAdding] = useState(false);
  const [draftProvider, setDraftProvider] = useState<AgentProviderId>('anthropic');
  const [epochs, setEpochs] = useState<Partial<Record<AgentProviderId, number>>>({});
  const connected = AGENT_PROVIDERS.filter((info) => statuses.some((status) => status.provider === info.id && status.hasKey));
  const available = AGENT_PROVIDERS.filter((info) => !connected.some((entry) => entry.id === info.id));
  const commit: Commit = (patch) => {
    const next = { ...current.current, ...patch, providerBaseUrls: { ...current.current.providerBaseUrls, ...patch.providerBaseUrls } } as AgentConfig;
    current.current = next;
    onConfig(next);
    const version = ++revision.current;
    const pending = queue.current.catch(() => {}).then(async () => {
      try {
        const saved = await window.castApi.agentUpdateConfig(patch);
        if (revision.current === version) { current.current = saved; onConfig(saved); }
      } catch (error) {
        const saved = await window.castApi.agentGetConfig();
        if (revision.current === version) { current.current = saved; onConfig(saved); }
        throw error;
      }
    });
    queue.current = pending;
    return pending;
  };
  // A ref-backed callback keeps catalog rows stable while edits remain sequential.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const toggle = useCallback(async (provider: AgentProviderId, id: string, checked: boolean) => {
    const previous = current.current.composerModels?.[provider] ?? [];
    const ids = checked ? [...new Set([...previous, id])] : previous.filter((entry) => entry !== id);
    await commitRef.current({ composerModels: { ...current.current.composerModels, [provider]: ids } });
  }, []);
  function changed(provider: AgentProviderId, next: AgentCredentialStatus[]) {
    onStatuses(next);
    setEpochs((value) => ({ ...value, [provider]: (value[provider] ?? 0) + 1 }));
    setAdding(false);
  }
  // Keep a legacy connection with a missing key editable without making it the active connection editor.
  const legacy = config.provider && !connected.some((entry) => entry.id === config.provider) ? config.provider : null;
  const rows = [...connected.map((entry) => entry.id), ...(legacy ? [legacy] : [])];
  const addable = available.filter((entry) => entry.id !== legacy);
  const newProvider = addable.some((entry) => entry.id === draftProvider) ? draftProvider : addable[0]?.id;
  return <>
    <Section.Root>
      <Section.Header><Label.xs>Connections</Label.xs><ReacstButton variant="ghost" disabled={addable.length === 0 || adding} onClick={() => { setDraftProvider(addable[0].id); setAdding(true); }}>Add connection</ReacstButton></Section.Header>
      <Section.Body>
        {rows.map((provider) => <ConnectionRow key={provider} provider={provider} options={AGENT_PROVIDERS.filter((entry) => entry.id === provider)} config={config} credential={statuses.find((entry) => entry.provider === provider)} commit={commit} onStatuses={(next) => changed(provider, next)} />)}
        {(adding || rows.length === 0) && newProvider ? <ConnectionRow key={`new-${newProvider}`} provider={newProvider} options={addable} onProvider={setDraftProvider} config={config} commit={commit} onStatuses={(next) => changed(newProvider, next)} onCancel={rows.length > 0 ? () => setAdding(false) : undefined} /> : null}
      </Section.Body>
    </Section.Root>
    <Section.Root>
      <Section.Header><Label.xs>Assistant models</Label.xs></Section.Header>
      <Section.Body>
        {connected.length === 0 ? <p className="text-sm text-tertiary">Add a connection to choose models.</p> : null}
        {connected.map((info) => <ProviderModels key={JSON.stringify([info.id, agentProviderBaseUrl(config, info.id), epochs[info.id] ?? 0])} provider={info.id} label={info.label} config={config} commit={commit} onToggle={toggle} />)}
      </Section.Body>
    </Section.Root>
  </>;
}

function ConnectionRow({ provider, options, onProvider, config, credential, commit, onStatuses, onCancel }: {
  provider: AgentProviderId; options: typeof AGENT_PROVIDERS; onProvider?: (provider: AgentProviderId) => void;
  config: AgentConfig; credential?: AgentCredentialStatus; commit: Commit;
  onStatuses: (statuses: AgentCredentialStatus[]) => void; onCancel?: () => void;
}) {
  const info = AGENT_PROVIDERS.find((entry) => entry.id === provider)!;
  const savedUrl = agentProviderBaseUrl(config, provider) ?? '';
  const editableUrl = provider === 'opencode' || provider === 'openai-compatible';
  const [url, setUrl] = useState(savedUrl);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setUrl(savedUrl); }, [savedUrl]);
  const dirty = key.length > 0 || url.trim() !== savedUrl;
  async function save() {
    if (busy) return;
    if (info.requiresBaseUrl && !url.trim()) { setError('Enter a base URL.'); return; }
    if (editableUrl && url.trim()) {
      try { const parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
      catch { setError('Enter a valid HTTP or HTTPS base URL.'); return; }
    }
    const apiKey = key.trim();
    setKey('');
    setBusy(true);
    setError(null);
    try {
      if (editableUrl && url.trim() !== savedUrl) await commit({ providerBaseUrls: { [provider]: url.trim() || null } });
      if (apiKey) onStatuses(await window.castApi.agentSetCredential({ provider, apiKey }));
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { onStatuses(await window.castApi.agentDeleteCredential({ provider })); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <div role="group" aria-label={`${info.label} connection`} className="flex flex-col gap-1.5">
    <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
      <FieldSelect label="Provider" value={provider} onChange={(value) => { if (!busy) onProvider?.(value as AgentProviderId); }} options={options.map((entry) => ({ value: entry.id, label: entry.label }))} />
      {editableUrl ? <FieldInput label="Base URL" ariaLabel={`${info.label} base URL`} value={url} onChange={setUrl} disabled={busy} placeholder={info.defaultBaseUrl ?? 'https://…/v1'} /> : <div className="min-h-8 truncate px-1 text-xs leading-8 text-tertiary" title={info.defaultBaseUrl ?? undefined}>{info.defaultBaseUrl ?? 'Default endpoint'}</div>}
      <div className="flex min-w-0 items-end gap-1">
        <div className="min-w-0 flex-1"><FieldInput label="API key" ariaLabel={`${info.label} API key`} type="text" value={key} onChange={setKey} disabled={busy} placeholder={credential?.hasKey ? `••••${credential.keyHint ?? ''}` : 'API key'} onKeyDown={(event) => { if (event.key === 'Enter' && (key.trim() || credential?.hasKey)) void save(); }} /></div>
        {dirty || !credential?.hasKey ? <ReacstButton disabled={busy || (!key.trim() && !credential?.hasKey)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</ReacstButton> : null}
        {dirty || onCancel ? <ReacstButton variant="ghost" disabled={busy} onClick={() => { setKey(''); setUrl(savedUrl); setError(null); onCancel?.(); }}>Cancel</ReacstButton> : credential?.hasKey ? <ReacstButton variant="ghost" disabled={busy} onClick={() => void remove()}>Remove</ReacstButton> : null}
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
  </div>;
}

function ProviderModels({ provider, label, config, commit, onToggle }: {
  provider: AgentProviderId; label: string; config: AgentConfig; commit: Commit;
  onToggle: (provider: AgentProviderId, id: string, checked: boolean) => Promise<void>;
}) {
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [validation, setValidation] = useState<string | null>(null);
  const request = useRef(0);
  const baseUrl = agentProviderBaseUrl(config, provider);
  const shortlist = config.composerModels?.[provider] ?? [];
  const active = config.provider === provider ? config.model : null;
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    void window.castApi.agentListModels({ provider, baseUrl, ...(attempt > 0 ? { refresh: true } : {}) }).then((list) => {
      if (!cancelled) setModels(list);
    }).catch((failure) => { if (!cancelled) setError(message(failure)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [provider, baseUrl, attempt]);
  useEffect(() => { request.current += 1; setValidation(null); return () => { request.current += 1; }; }, [active]);
  const byId = new Map(models.map((entry) => [entry.id, entry]));
  for (const id of [...shortlist, ...(active ? [active] : [])]) if (!byId.has(id)) byId.set(id, { id, label: prettifyModelId(id), vendor: inferModelVendor(id), isFree: id.endsWith(':free'), supportsTools: true, contextWindow: null, maxOutputTokens: null });
  const all = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  const choices = all.filter((entry) => shortlist.length === 0 || shortlist.includes(entry.id) || entry.id === active);
  const filtered = all.filter((entry) => `${entry.label} ${entry.id}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = useCallback((id: string, checked: boolean) => { setError(null); void onToggle(provider, id, checked).catch((failure) => setError(message(failure))); }, [provider, onToggle]);
  async function validate() {
    if (!active) return;
    const generation = ++request.current;
    setValidation('Checking…');
    try {
      const result = await window.castApi.agentValidateModel({ provider, model: active, baseUrl });
      if (request.current === generation) setValidation(result === 'valid' ? 'Valid' : result === 'not-found' ? 'Not found' : 'Unknown');
    } catch { if (request.current === generation) setValidation('Unknown'); }
  }
  return <div role="group" aria-label={`${label} models`} className="flex flex-col gap-2 border-b border-secondary pb-4 last:border-0 last:pb-0">
    <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-primary">{label}</span><ReacstButton variant="ghost" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>{loading ? 'Loading…' : error ? 'Retry' : 'Refresh'}</ReacstButton></div>
    <FieldSelect label={`${label} default model`} value={active ?? ''} onChange={(model) => { if (model) void commit({ provider, model }).catch((failure) => setError(message(failure))); }}>
      <FieldSelect.Option value="">Choose model</FieldSelect.Option>
      {choices.map((entry) => <FieldSelect.Option key={entry.id} value={entry.id}><span className="flex min-w-0 items-center gap-1.5"><ModelVendorLogo vendor={entry.vendor} className="size-4" /><span className="truncate">{entry.label}</span>{entry.isFree ? <span className="text-xs text-success">Free</span> : null}</span></FieldSelect.Option>)}
    </FieldSelect>
    <div className="flex items-center justify-between gap-2"><Label.xs>Composer models</Label.xs><span className="text-xs text-tertiary">{shortlist.length ? `${shortlist.length} selected` : 'All models'}</span>{shortlist.length > 0 ? <ReacstButton variant="ghost" onClick={() => void commit({ composerModels: { ...config.composerModels, [provider]: [] } }).catch((failure) => setError(message(failure)))}>Clear</ReacstButton> : null}</div>
    <FieldInput value={filter} onChange={setFilter} placeholder="Filter models" ariaLabel={`Filter ${label} models`} />
    <div className="max-h-64 overflow-y-auto rounded border border-secondary">
      {filtered.map((entry) => <ComposerModelRow key={entry.id} model={entry} checked={shortlist.includes(entry.id)} onToggle={toggle} />)}
      {filtered.length === 0 ? <p className="px-2 py-1.5 text-sm text-tertiary">{filter ? 'No matches' : loading ? 'Loading…' : 'No models available.'}</p> : null}
    </div>
    {active ? <div className="flex items-center gap-2"><ReacstButton variant="ghost" onClick={() => void validate()} disabled={validation === 'Checking…'}>Validate</ReacstButton>{validation ? <span className="text-xs text-secondary">{validation}</span> : null}</div> : null}
    {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
  </div>;
}

const ComposerModelRow = memo(function ComposerModelRow({ model, checked, onToggle }: { model: AgentModelInfo; checked: boolean; onToggle: (id: string, checked: boolean) => void }) {
  const context = model.contextWindow === null ? null : model.contextWindow >= 1_000_000 ? `${Math.round(model.contextWindow / 10_000) / 100}M context` : model.contextWindow >= 1000 ? `${Math.round(model.contextWindow / 1000)}k context` : `${model.contextWindow} context`;
  return <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-tertiary/60">
    <input type="checkbox" checked={checked} onChange={(event) => onToggle(model.id, event.target.checked)} className="peer sr-only" />
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded border border-primary bg-primary text-transparent peer-checked:border-brand peer-checked:bg-brand/15 peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand"><Check size={11} strokeWidth={2.5} /></span>
    <ModelVendorLogo vendor={model.vendor} className="size-4" /><span className="min-w-0 flex-1 truncate text-primary">{model.label}</span>
    {model.isFree ? <span className="rounded-sm bg-success/15 px-1 py-0.5 text-[10px] font-medium text-success">Free</span> : null}
    {context ? <span className="shrink-0 text-tertiary">{context}</span> : null}
  </label>;
});
