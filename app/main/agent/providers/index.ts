import type { AgentProviderId } from '@lumacast/protocol';
import { AnthropicAdapter } from './anthropic-adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible-adapter';
import { OpenCodeZenAdapter } from './opencode-zen-adapter';
import type { ProviderAdapter, ProviderAdapterOptions } from './types';

export type {
  AssistantPart,
  ProviderAdapter,
  ProviderAdapterOptions,
  ProviderChatRequest,
  ProviderErrorCode,
  ProviderMessage,
  ProviderStopReason,
  ProviderStreamEvent,
  ProviderToolDefinition,
} from './types';
export { ProviderError } from './types';
export { AnthropicAdapter } from './anthropic-adapter';
export { OpenAiCompatibleAdapter, type OpenAiCompatibleProviderId } from './openai-compatible-adapter';
export { OpenCodeZenAdapter } from './opencode-zen-adapter';

/**
 * Builds the `ProviderAdapter` for one `AgentProviderId`. OpenCode Zen owns
 * mixed-protocol routing; the remaining non-Anthropic providers use the
 * OpenAI Chat Completions wire format.
 */
export function createProviderAdapter(provider: AgentProviderId, options: ProviderAdapterOptions): ProviderAdapter {
  if (provider === 'anthropic') {
    return new AnthropicAdapter(options);
  }
  if (provider === 'opencode') {
    return new OpenCodeZenAdapter(options);
  }
  return new OpenAiCompatibleAdapter(provider, options);
}
