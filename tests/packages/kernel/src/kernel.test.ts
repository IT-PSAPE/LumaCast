import { describe, expect, it, vi } from 'vitest';
import { createId, nowIso } from '../../../../packages/kernel/src/index';

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


it('uses browser Web Crypto without requiring a Node builtin', () => {
  const uuid = '00000000-0000-4000-8000-000000000000';
  const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid);
  try { expect(createId()).toBe(uuid); expect(randomUUID).toHaveBeenCalledOnce(); }
  finally { randomUUID.mockRestore(); }
});
