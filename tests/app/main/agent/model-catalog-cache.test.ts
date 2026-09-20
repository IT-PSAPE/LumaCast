// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentModelInfo } from '@lumacast/protocol';
import { ModelCatalogCache } from '../../../../app/main/agent/model-catalog-cache';

const models: AgentModelInfo[] = [{ id: 'maker/model:free', label: 'Model', contextWindow: 32000, maxOutputTokens: null, supportsTools: true, isFree: true, vendor: null }];
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-cache-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('ModelCatalogCache', () => {
  it('shares concurrent fetches and persists metadata across restarts', async () => {
    const cache = new ModelCatalogCache(dir);
    const load = vi.fn(async () => models);
    expect(await Promise.all([cache.list('openrouter', null, load), cache.list('openrouter', null, load)])).toEqual([models, models]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await new ModelCatalogCache(dir).list('openrouter', null, load)).toEqual(models);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps stale lists usable while revalidating, but never declares a missing model from stale data', async () => {
    let now = 100;
    const cache = new ModelCatalogCache(dir, () => now);
    await cache.list('openrouter', null, async () => models);
    now += 3_600_001;
    const fail = vi.fn(async (): Promise<AgentModelInfo[]> => { throw new Error('offline'); });
    expect(await cache.list('openrouter', null, fail)).toEqual(models);
    expect(await cache.validate('openrouter', null, 'missing', fail)).toBe('unknown');
    expect(await cache.validate('openrouter', null, models[0].id, fail)).toBe('unknown');
  });

  it('validates against a successful catalog and allows an explicit refresh', async () => {
    const cache = new ModelCatalogCache(dir);
    const load = vi.fn(async () => models);
    expect(await cache.validate('openrouter', null, models[0].id, load)).toBe('valid');
    expect(await cache.validate('openrouter', null, 'missing', load)).toBe('not-found');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.list('openrouter', null, async () => [], true)).toEqual([]);
    expect(await cache.validate('openrouter', null, models[0].id, load)).toBe('not-found');
  });

  it('preserves the last successful catalog on refresh failure', async () => {
    const cache = new ModelCatalogCache(dir);
    await cache.list('openrouter', null, async () => models);
    await expect(cache.list('openrouter', null, async () => { throw new Error('offline'); }, true)).rejects.toThrow('offline');
    expect(await cache.list('openrouter', null, async () => [])).toEqual(models);
  });

  it('isolates endpoints and invalidates both memory and disk after credential changes', async () => {
    const cache = new ModelCatalogCache(dir);
    await cache.list('openai-compatible', 'https://a.test/v1', async () => models);
    expect(await cache.list('openai-compatible', 'https://b.test/v1', async () => [])).toEqual([]);
    cache.invalidate('openai-compatible');
    expect(await new ModelCatalogCache(dir).list('openai-compatible', 'https://a.test/v1', async () => [])).toEqual([]);
  });

  it('does not resurrect an invalidated in-flight response', async () => {
    const cache = new ModelCatalogCache(dir);
    let resolve!: (value: AgentModelInfo[]) => void;
    const pending = cache.list('openrouter', null, () => new Promise((done) => { resolve = done; }));
    await Promise.resolve();
    cache.invalidate('openrouter');
    resolve(models);
    await pending;
    expect(await cache.list('openrouter', null, async () => [])).toEqual([]);
  });

  it('ignores malformed persisted entries without affecting configuration', async () => {
    fs.writeFileSync(path.join(dir, 'agent-model-catalogs.json'), JSON.stringify({ version: 1, entries: [{ key: 'openrouter', models: [null] }] }));
    expect(await new ModelCatalogCache(dir).list('openrouter', null, async () => models)).toEqual(models);
  });
});
