import { describe, expect, it } from 'vitest';
import type { CodecContext } from '../../../../packages/protocol/src/codecs';
import { matrixForTier } from '../../../../packages/protocol/src/agent';
import {
  decodeAgentExtractDocumentInput,
  decodeAgentFilesystemRootInput,
  decodeAgentImportMediaInput,
  decodeAgentListModelsInput,
  decodeAgentMcpClientCreateInput,
  decodeAgentMcpClientIdInput,
  decodeAgentMcpClientPermissionsInput,
  decodeAgentMcpEnabledInput,
  decodeAgentProviderInput,
  decodeAgentRenameThreadInput,
  decodeAgentReplaceMediaSourceInput,
  decodeAgentSendMessageInput,
  decodeAgentSetCredentialInput,
  decodeAgentSetThreadModelInput,
  decodeAgentThreadCreateInput,
  decodeAgentThreadIdInput,
  decodeAgentValidateModelInput,
} from '../../../../packages/protocol/src/agent-runtime';

const CONTEXT: CodecContext = { boundary: 'test', operation: 'unit', path: '' };

describe('thread inputs', () => {
  it('decodes a send-message input', () => {
    expect(decodeAgentSendMessageInput({ threadId: 't1', text: 'hello' }, CONTEXT)).toEqual({
      threadId: 't1',
      text: 'hello',
    });
  });

  it('allows an empty message body but not an empty thread id', () => {
    expect(decodeAgentSendMessageInput({ threadId: 't1', text: '' }, CONTEXT).text).toBe('');
    expect(() => decodeAgentSendMessageInput({ threadId: '', text: 'hi' }, CONTEXT)).toThrow();
  });

  it('rejects a non-object, an unknown key, and a missing field', () => {
    expect(() => decodeAgentSendMessageInput('nope', CONTEXT)).toThrow();
    expect(() => decodeAgentSendMessageInput({ threadId: 't1', text: 'hi', extra: 1 }, CONTEXT)).toThrow();
    expect(() => decodeAgentSendMessageInput({ threadId: 't1' }, CONTEXT)).toThrow();
  });

  it('decodes thread id, rename, and model-override inputs', () => {
    expect(decodeAgentThreadIdInput({ id: 't1' }, CONTEXT)).toEqual({ id: 't1' });
    expect(decodeAgentRenameThreadInput({ id: 't1', title: 'Sunday' }, CONTEXT)).toEqual({ id: 't1', title: 'Sunday' });
    expect(decodeAgentSetThreadModelInput({ id: 't1', provider: 'anthropic', model: 'claude-opus-4' }, CONTEXT)).toEqual({
      id: 't1',
      provider: 'anthropic',
      model: 'claude-opus-4',
    });
  });

  it('accepts a null provider/model as "fall back to the config"', () => {
    expect(decodeAgentSetThreadModelInput({ id: 't1', provider: null, model: null }, CONTEXT)).toEqual({
      id: 't1',
      provider: null,
      model: null,
    });
  });

  it('rejects an unknown provider on a thread override', () => {
    expect(() => decodeAgentSetThreadModelInput({ id: 't1', provider: 'llama-cpp', model: 'x' }, CONTEXT)).toThrow();
  });

  it('decodes a thread-create input with and without a title', () => {
    expect(decodeAgentThreadCreateInput({ provider: null, model: null }, CONTEXT)).toEqual({
      provider: null,
      model: null,
    });
    expect(decodeAgentThreadCreateInput({ title: 'Notes', provider: 'openai', model: 'gpt-5' }, CONTEXT)).toEqual({
      title: 'Notes',
      provider: 'openai',
      model: 'gpt-5',
    });
  });
});

describe('credential and model inputs', () => {
  it('decodes a set-credential input and refuses an empty key', () => {
    expect(decodeAgentSetCredentialInput({ provider: 'anthropic', apiKey: 'sk-x' }, CONTEXT)).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-x',
    });
    expect(() => decodeAgentSetCredentialInput({ provider: 'anthropic', apiKey: '' }, CONTEXT)).toThrow();
  });

  it('decodes a provider-only input', () => {
    expect(decodeAgentProviderInput({ provider: 'openrouter' }, CONTEXT)).toEqual({ provider: 'openrouter' });
    expect(() => decodeAgentProviderInput({ provider: 'nope' }, CONTEXT)).toThrow();
  });

  it('treats an absent baseUrl and an explicit null differently', () => {
    expect(decodeAgentListModelsInput({ provider: 'openai' }, CONTEXT)).toEqual({ provider: 'openai' });
    expect(decodeAgentListModelsInput({ provider: 'openai', baseUrl: null }, CONTEXT)).toEqual({
      provider: 'openai',
      baseUrl: null,
    });
    expect(decodeAgentListModelsInput({ provider: 'openai', baseUrl: 'http://localhost:1234/v1' }, CONTEXT)).toEqual({
      provider: 'openai',
      baseUrl: 'http://localhost:1234/v1',
    });
  });

  it('requires a model on validate', () => {
    expect(decodeAgentValidateModelInput({ provider: 'openai', model: 'gpt-5' }, CONTEXT)).toEqual({
      provider: 'openai',
      model: 'gpt-5',
    });
    expect(() => decodeAgentValidateModelInput({ provider: 'openai', model: '' }, CONTEXT)).toThrow();
  });
});

describe('filesystem inputs', () => {
  it('decodes a root grant/revoke path', () => {
    expect(decodeAgentFilesystemRootInput({ path: '/Users/nico/Media' }, CONTEXT)).toEqual({ path: '/Users/nico/Media' });
    expect(() => decodeAgentFilesystemRootInput({ path: '' }, CONTEXT)).toThrow();
  });

  it('decodes an import with an optional name and type', () => {
    expect(decodeAgentImportMediaInput({ path: '/m/a.png' }, CONTEXT)).toEqual({ path: '/m/a.png' });
    expect(decodeAgentImportMediaInput({ path: '/m/a.png', name: 'Logo', type: 'image' }, CONTEXT)).toEqual({
      path: '/m/a.png',
      name: 'Logo',
      type: 'image',
    });
  });

  it('rejects a media type outside the three real ones', () => {
    expect(() => decodeAgentImportMediaInput({ path: '/m/a.pdf', type: 'document' }, CONTEXT)).toThrow();
  });

  it('decodes a replace-source input', () => {
    expect(decodeAgentReplaceMediaSourceInput({ id: 'a1', path: '/m/b.png' }, CONTEXT)).toEqual({
      id: 'a1',
      path: '/m/b.png',
    });
    expect(() => decodeAgentReplaceMediaSourceInput({ id: '', path: '/m/b.png' }, CONTEXT)).toThrow();
  });

  it('floors maxChars and rejects a non-positive one', () => {
    expect(decodeAgentExtractDocumentInput({ path: '/d/a.pdf', maxChars: 1000.9 }, CONTEXT)).toEqual({
      path: '/d/a.pdf',
      maxChars: 1000,
    });
    expect(() => decodeAgentExtractDocumentInput({ path: '/d/a.pdf', maxChars: 0 }, CONTEXT)).toThrow();
    expect(() => decodeAgentExtractDocumentInput({ path: '/d/a.pdf', maxChars: -1 }, CONTEXT)).toThrow();
    expect(() => decodeAgentExtractDocumentInput({ path: '/d/a.pdf', maxChars: 'lots' }, CONTEXT)).toThrow();
  });
});

describe('mcp inputs', () => {
  it('decodes the enabled toggle and rejects a truthy non-boolean', () => {
    expect(decodeAgentMcpEnabledInput({ enabled: true }, CONTEXT)).toEqual({ enabled: true });
    expect(() => decodeAgentMcpEnabledInput({ enabled: 'yes' }, CONTEXT)).toThrow();
  });

  it('decodes a client create input with an optional tier', () => {
    expect(decodeAgentMcpClientCreateInput({ name: 'Claude' }, CONTEXT)).toEqual({ name: 'Claude' });
    expect(decodeAgentMcpClientCreateInput({ name: 'Claude', tier: 'read-only' }, CONTEXT)).toEqual({
      name: 'Claude',
      tier: 'read-only',
    });
    expect(() => decodeAgentMcpClientCreateInput({ name: 'Claude', tier: 'yolo' }, CONTEXT)).toThrow();
    expect(() => decodeAgentMcpClientCreateInput({ name: '' }, CONTEXT)).toThrow();
  });

  it('decodes a client id input', () => {
    expect(decodeAgentMcpClientIdInput({ clientId: 'c1' }, CONTEXT)).toEqual({ clientId: 'c1' });
    expect(() => decodeAgentMcpClientIdInput({ clientId: '' }, CONTEXT)).toThrow();
  });

  it('validates a permissions patch through the shared principal-permissions decoder', () => {
    const permissions = { matrix: matrixForTier('content'), showSafetyInterlock: false };
    expect(decodeAgentMcpClientPermissionsInput({ clientId: 'c1', permissions }, CONTEXT)).toEqual({
      clientId: 'c1',
      permissions,
    });
    expect(() =>
      decodeAgentMcpClientPermissionsInput(
        { clientId: 'c1', permissions: { matrix: { read: 'maybe' }, showSafetyInterlock: true } },
        CONTEXT,
      ),
    ).toThrow();
  });
});
