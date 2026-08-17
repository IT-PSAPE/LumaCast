import { describe, expect, it } from 'vitest';
import { createId, nowIso } from './index';

describe('@lumacast/kernel', () => {
  it('createId produces a well-formed v4 UUID', () => {
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('createId produces a distinct value on every call', () => {
    expect(createId()).not.toBe(createId());
  });

  it('nowIso produces a parseable ISO-8601 timestamp', () => {
    const iso = nowIso();
    expect(iso).toBe(new Date(iso).toISOString());
  });
});
