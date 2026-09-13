import type { AgentProviderId } from '@lumacast/protocol';
import { AnthropicAdapter } from './anthropic-adapter';
import { OpenAiCompatibleAdapter } from './openai-compatible-adapter';
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

/**
 * Builds the `ProviderAdapter` for one `AgentProviderId`. `anthropic` gets
 * the native Anthropic SDK adapter; every other provider (`openai`,
 * `google`, `openrouter`, `openai-compatible`) speaks the OpenAI Chat
 * Completions wire format and shares `OpenAiCompatibleAdapter`.
 */
export function createProviderAdapter(provider: AgentProviderId, options: ProviderAdapterOptions): ProviderAdapter {
  if (provider === 'anthropic') {
    return new AnthropicAdapter(options);
  }
  return new OpenAiCompatibleAdapter(provider, options);
}
