import type { AgentModelInfo } from '@lumacast/protocol';
import { AnthropicAdapter } from './anthropic-adapter';
import { GoogleGeminiAdapter } from './google-gemini-adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible-adapter';
import { OpenAiResponsesAdapter } from './openai-responses-adapter';
import { withRequestTimeout } from './request-timeout';
import { ProviderError } from './types';
import type { ProviderAdapter, ProviderAdapterOptions, ProviderChatRequest, ProviderStreamEvent } from './types';

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';
const CATALOG_TIMEOUT_MS = 30_000;

type ZenProtocol = 'responses' | 'messages' | 'gemini' | 'chat-completions';

interface OpenCodeZenDependencies {
  fetch: typeof fetch;
  createDelegate: (protocol: ZenProtocol, options: ProviderAdapterOptions) => Pick<ProviderAdapter, 'chat'>;
  requestTimeoutMs: number;
}

interface ModelsDevModel {
  name?: unknown;
  tool_call?: unknown;
  limit?: { context?: unknown; output?: unknown };
  provider?: { npm?: unknown };
  cost?: { input?: unknown; output?: unknown };
}

interface LiveModel {
  id?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fallbackLabel(modelId: string): string {
  return modelId
    .split('-')
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

function protocolFor(modelId: string, metadata?: ModelsDevModel): ZenProtocol {
  switch (metadata?.provider?.npm) {
    case '@ai-sdk/openai':
      return 'responses';
    case '@ai-sdk/anthropic':
      return 'messages';
    case '@ai-sdk/google':
      return 'gemini';
    default:
      if (/^(gpt|grok|muse)-/.test(modelId)) return 'responses';
      if (/^(claude|qwen)/.test(modelId)) return 'messages';
      if (modelId.startsWith('gemini-')) return 'gemini';
      return 'chat-completions';
  }
}

function isFreeModel(modelId: string, metadata?: ModelsDevModel): boolean {
  const input = metadata?.cost?.input;
  const output = metadata?.cost?.output;
  if (input === 0 && output === 0) return true;
  return modelId.endsWith('-free') || modelId === 'big-pickle';
}

function errorForStatus(status: number, statusText: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', statusText, status);
  if (status === 429) return new ProviderError('rate_limit', statusText, status);
  return new ProviderError('provider', statusText, status);
}

function normalizeBaseUrl(value: string | null): string {
  return (value?.trim() || OPENCODE_ZEN_BASE_URL).replace(/\/+$/, '');
}

export class OpenCodeZenAdapter implements ProviderAdapter {
  readonly id = 'opencode' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly createDelegate: OpenCodeZenDependencies['createDelegate'];
  private readonly requestTimeoutMs: number;
  private readonly metadataByModel = new Map<string, ModelsDevModel>();
  private metadataLoaded = false;

  constructor(options: ProviderAdapterOptions, dependencies?: Partial<OpenCodeZenDependencies>) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = dependencies?.fetch ?? globalThis.fetch;
    this.requestTimeoutMs = dependencies?.requestTimeoutMs ?? CATALOG_TIMEOUT_MS;
    this.createDelegate = dependencies?.createDelegate ?? ((protocol, delegateOptions) => {
      switch (protocol) {
        case 'responses':
          return new OpenAiResponsesAdapter(delegateOptions);
        case 'messages':
          return new AnthropicAdapter(delegateOptions);
        case 'gemini':
          return new GoogleGeminiAdapter(delegateOptions);
        case 'chat-completions':
          return new OpenAiCompatibleAdapter('openai-compatible', delegateOptions);
      }
    });
  }

  private async loadMetadata(signal?: AbortSignal): Promise<void> {
    if (this.metadataLoaded) return;
    const timeout = withRequestTimeout(signal, this.requestTimeoutMs);
    try {
      const metadataResponse = await this.fetcher(MODELS_DEV_URL, { signal: timeout.signal });
      if (!metadataResponse.ok) return;
      const metadataJson = await metadataResponse.json() as { opencode?: { models?: Record<string, ModelsDevModel> } };
      for (const [modelId, metadata] of Object.entries(metadataJson.opencode?.models ?? {})) {
        this.metadataByModel.set(modelId, metadata);
      }
      this.metadataLoaded = true;
    } catch {
      if (signal?.aborted) throw new ProviderError('aborted', 'OpenCode Zen model loading was cancelled');
      // Optional enrichment. Live model IDs and family-based routing remain
      // available if Models.dev is temporarily unreachable.
    } finally {
      timeout.dispose();
    }
  }

  async listModels(signal?: AbortSignal): Promise<AgentModelInfo[]> {
    let liveJson: { data?: unknown };
    const timeout = withRequestTimeout(signal, this.requestTimeoutMs);
    try {
      const liveResponse = await this.fetcher(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: timeout.signal,
      });
      if (!liveResponse.ok) throw errorForStatus(liveResponse.status, liveResponse.statusText || `HTTP ${liveResponse.status}`);
      try {
        liveJson = await liveResponse.json() as { data?: unknown };
      } catch (error) {
        if (signal?.aborted) throw new ProviderError('aborted', error instanceof Error ? error.message : String(error));
        if (timeout.didTimeout()) throw new ProviderError('network', `Request timed out after ${this.requestTimeoutMs}ms`);
        throw new ProviderError('provider', error instanceof Error ? error.message : 'OpenCode Zen returned invalid JSON');
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (signal?.aborted) {
        throw new ProviderError('aborted', error instanceof Error ? error.message : String(error));
      }
      throw new ProviderError(
        'network',
        timeout.didTimeout() ? `Request timed out after ${this.requestTimeoutMs}ms` : error instanceof Error ? error.message : String(error),
      );
    } finally {
      timeout.dispose();
    }
    if (!Array.isArray(liveJson.data)) throw new ProviderError('provider', 'OpenCode Zen returned an invalid model catalog');

    await this.loadMetadata(signal);

    const models: AgentModelInfo[] = [];
    for (const entry of liveJson.data as LiveModel[]) {
      if (typeof entry?.id !== 'string' || entry.id.trim() === '') continue;
      const metadata = this.metadataByModel.get(entry.id);
      models.push({
        id: entry.id,
        label: typeof metadata?.name === 'string' && metadata.name.trim() ? metadata.name : fallbackLabel(entry.id),
        contextWindow: numberOrNull(metadata?.limit?.context),
        maxOutputTokens: numberOrNull(metadata?.limit?.output),
        supportsTools: typeof metadata?.tool_call === 'boolean' ? metadata.tool_call : true,
        isFree: isFreeModel(entry.id, metadata),
      });
    }

    return models.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true }));
  }

  async validateModel(modelId: string, signal?: AbortSignal): Promise<'valid' | 'not-found' | 'unknown'> {
    try {
      const models = await this.listModels(signal);
      return models.some((model) => model.id === modelId) ? 'valid' : 'not-found';
    } catch {
      return 'unknown';
    }
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    await this.loadMetadata(request.signal);
    const protocol = protocolFor(request.model, this.metadataByModel.get(request.model));
    const delegate = this.createDelegate(protocol, { apiKey: this.apiKey, baseUrl: this.baseUrl });
    yield* delegate.chat(request);
  }
}
