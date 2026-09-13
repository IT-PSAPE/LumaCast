import { afterEach, describe, expect, it } from 'vitest';
import {
  __clearRegisteredSecretsForTests,
  redactString,
  redactValue,
  registerSecretForRedaction,
  unregisterSecretForRedaction,
} from '../../../app/main/redaction';

afterEach(() => {
  __clearRegisteredSecretsForTests();
});

describe('registerSecretForRedaction / unregisterSecretForRedaction', () => {
  it('masks a registered secret wherever it appears', () => {
    registerSecretForRedaction('super-secret-value-123');
    expect(redactString('token=super-secret-value-123 in request')).toBe('token=[redacted] in request');
  });

  it('ignores empty and short (<8 char) values', () => {
    registerSecretForRedaction('');
    registerSecretForRedaction('short12');
    expect(redactString('short12 stays as-is')).toBe('short12 stays as-is');
  });

  it('registers an 8-char value (the boundary) as a secret', () => {
    registerSecretForRedaction('eightchr');
    expect(redactString('value is eightchr here')).toBe('value is [redacted] here');
  });

  it('stops masking once unregistered', () => {
    registerSecretForRedaction('super-secret-value-123');
    unregisterSecretForRedaction('super-secret-value-123');
    expect(redactString('token=super-secret-value-123')).toBe('token=super-secret-value-123');
  });
});

describe('redactString — pattern-based redaction', () => {
  it('redacts an Anthropic key (sk-ant-...) keeping a 4-char debug prefix', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const result = redactString(`key: ${key}`);
    expect(result).toBe(`key: sk-a…[redacted]`);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts an OpenRouter key (sk-or-...) before the generic sk- pattern would', () => {
    const key = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789';
    const result = redactString(`Authorization header uses ${key}`);
    expect(result).toBe('Authorization header uses sk-o…[redacted]');
  });

  it('redacts an OpenAI-style key (sk-...)', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const result = redactString(`OPENAI_API_KEY=${key}`);
    expect(result).toBe('OPENAI_API_KEY=sk-a…[redacted]');
  });

  it('redacts a Google API key (AIza...)', () => {
    const key = `AIza${'a'.repeat(35)}`;
    const result = redactString(`googleKey ${key} end`);
    expect(result).toBe('googleKey AIza…[redacted] end');
  });

  it('redacts a Bearer token in an Authorization header', () => {
    const result = redactString('Authorization: Bearer abcdefgh12345.jwt-looking-token');
    expect(result).toMatch(/^Authorization: Bearer abcd…\[redacted\]$/);
  });

  it('redacts an x-api-key header value', () => {
    const result = redactString('x-api-key: 0123456789abcdef');
    expect(result).toBe('x-api-key: 0123…[redacted]');
  });

  it('redacts x-api-key given as a quoted header/JSON value', () => {
    const result = redactString('"x-api-key": "0123456789abcdef"');
    expect(result).toContain('0123…[redacted]');
    expect(result).not.toContain('0123456789abcdef');
  });

  it('redacts JSON-ish "apiKey" values', () => {
    const result = redactString('{"apiKey":"plainsecretvalue123"}');
    expect(result).toBe('{"apiKey":"plai…[redacted]"}');
  });

  it('redacts JSON-ish "api_key" values', () => {
    const result = redactString('{"api_key": "plainsecretvalue123"}');
    expect(result).toBe('{"api_key": "plai…[redacted]"}');
  });

  it('redacts JSON-ish "token" values', () => {
    const result = redactString('{"token":"xyzsecretvalue4567"}');
    expect(result).toBe('{"token":"xyzs…[redacted]"}');
  });

  it('redacts JSON-ish "secret" values', () => {
    const result = redactString('{"secret":"anothersecretvalue"}');
    expect(result).toBe('{"secret":"anot…[redacted]"}');
  });

  it('leaves ordinary, non-secret text completely untouched', () => {
    const text = 'Rendered 4 slides in 12ms for deck "Q3 Review" at 1920x1080.';
    expect(redactString(text)).toBe(text);
  });

  it('leaves short-ish incidental strings that merely start with sk- alone', () => {
    // Too short to match the 20+ trailing char requirement of any pattern.
    expect(redactString('sk-short')).toBe('sk-short');
  });
});

describe('redactValue — deep walk', () => {
  it('redacts strings nested in arrays and plain objects', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const input = {
      messages: [{ role: 'user', content: `use key ${key} please` }],
      nested: { deeper: { value: `also has ${key}` } },
    };
    const result = redactValue(input) as typeof input;
    expect(result.messages[0].content).toContain('sk-a…[redacted]');
    expect(result.messages[0].content).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.nested.deeper.value).toContain('sk-a…[redacted]');
  });

  it('redacts values under sensitive key names regardless of content', () => {
    const input = {
      apiKey: 'not-shaped-like-a-known-key-pattern',
      api_key: 'also-plain-text',
      authorization: 'plain',
      token: 'plain-token-text',
      secret: 'plain-secret-text',
      password: 'hunter2',
      unrelatedField: 'stays exactly as-is',
    };
    const result = redactValue(input) as Record<string, unknown>;
    expect(result.apiKey).toBe('[redacted]');
    expect(result.api_key).toBe('[redacted]');
    expect(result.authorization).toBe('[redacted]');
    expect(result.token).toBe('[redacted]');
    expect(result.secret).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
    expect(result.unrelatedField).toBe('stays exactly as-is');
  });

  it('is case-insensitive about sensitive key names', () => {
    const result = redactValue({ ApiKey: 'plaintext-value' }) as Record<string, unknown>;
    expect(result.ApiKey).toBe('[redacted]');
  });

  it('does not touch non-string, non-plain-object values', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const input = { count: 3, enabled: true, when: date, nothing: null, missing: undefined };
    const result = redactValue(input) as typeof input;
    expect(result.count).toBe(3);
    expect(result.enabled).toBe(true);
    expect(result.when).toBe(date);
    expect(result.nothing).toBeNull();
    expect(result.missing).toBeUndefined();
  });

  it('handles cycles without throwing or looping forever', () => {
    type Cyclic = { name: string; self?: Cyclic };
    const obj: Cyclic = { name: 'root' };
    obj.self = obj;
    expect(() => redactValue(obj)).not.toThrow();
    const result = redactValue(obj) as { name: string; self: unknown };
    expect(result.name).toBe('root');
    expect(result.self).toBe('[circular]');
  });

  it('handles cyclic arrays too', () => {
    const arr: unknown[] = ['a'];
    arr.push(arr);
    const result = redactValue(arr) as unknown[];
    expect(result[0]).toBe('a');
    expect(result[1]).toBe('[circular]');
  });

  it('does not falsely flag a repeated (non-cyclic) shared reference as circular', () => {
    const shared = { value: 'shared-secret-token-value' };
    const input = { first: shared, second: shared };
    const result = redactValue(input) as { first: { value: string }; second: { value: string } };
    expect(result.first).not.toBe('[circular]');
    expect(result.second).not.toBe('[circular]');
    expect(result.first.value).toBe(shared.value);
  });

  it('stops descending past the depth limit without throwing', () => {
    type Deep = { child?: Deep; leaf?: string };
    let root: Deep = { leaf: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' };
    for (let i = 0; i < 20; i += 1) {
      root = { child: root };
    }
    expect(() => redactValue(root)).not.toThrow();
  });

  it('redacts Error objects: message and stack, without mutating the original', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const error = new Error(`request failed with key ${key}`);
    const originalMessage = error.message;
    const originalStack = error.stack;

    const result = redactValue(error) as Error;

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('sk-a…[redacted]');
    expect(result.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.stack).not.toContain('abcdefghijklmnopqrstuvwxyz');

    // Original error is untouched.
    expect(error.message).toBe(originalMessage);
    expect(error.stack).toBe(originalStack);
  });

  it('redacts extra enumerable properties on an Error, including sensitive-named ones', () => {
    const error = new Error('boom') as Error & { apiKey?: string; requestId?: string };
    error.apiKey = 'some-plain-key-value';
    error.requestId = 'req-123';

    const result = redactValue(error) as Error & { apiKey?: string; requestId?: string };
    expect(result.apiKey).toBe('[redacted]');
    expect(result.requestId).toBe('req-123');
  });

  it('leaves plain, non-secret objects completely untouched in shape and values', () => {
    const input = { title: 'Deck', slides: 4, tags: ['intro', 'outro'] };
    const result = redactValue(input);
    expect(result).toEqual(input);
  });
});
