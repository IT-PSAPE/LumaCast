// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AGENT_PROVIDER_IDS } from '@lumacast/protocol';
import { createProviderAdapter } from '../../../../../app/main/agent/providers/index';
import { OpenCodeZenAdapter } from '../../../../../app/main/agent/providers/opencode-zen-adapter';

// Minimal fakes — the factory test only needs construction to succeed and
// `.id` to come back right; the adapters' own behavior is covered in
// anthropic-adapter.test.ts and openai-compatible-adapter.test.ts.
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    static APIError = class extends Error {};
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
    static NotFoundError = class extends Error {};
    static APIConnectionError = class extends Error {};
    static APIUserAbortError = class extends Error {};

    models = { list: vi.fn(), retrieve: vi.fn() };
    messages = { stream: vi.fn() };

    constructor(public options: unknown) {}
  }
  return { default: FakeAnthropic };
});

vi.mock('openai', () => {
  class FakeOpenAI {
    static APIError = class extends Error {};
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
    static NotFoundError = class extends Error {};
    static APIConnectionError = class extends Error {};
    static APIUserAbortError = class extends Error {};

    models = { list: vi.fn(), retrieve: vi.fn() };
    chat = { completions: { create: vi.fn() } };

    constructor(public options: unknown) {}
  }
  return { default: FakeOpenAI };
});

describe('createProviderAdapter', () => {
  it.each(AGENT_PROVIDER_IDS)('builds an adapter with id %s', (providerId) => {
    const adapter = createProviderAdapter(providerId, {
      apiKey: 'test-key',
      baseUrl: providerId === 'openai-compatible' ? 'https://example.com/v1' : null,
    });

    expect(adapter.id).toBe(providerId);
  });

  it('uses the mixed-protocol Zen adapter for OpenCode', () => {
    expect(createProviderAdapter('opencode', { apiKey: 'test-key', baseUrl: null })).toBeInstanceOf(OpenCodeZenAdapter);
  });
});
