import { describe, expect, it } from 'vitest';
import type { PlatformAdapterDeps, PlatformEnv } from '../../../../../apps/cloud/main/platform/adapter';
import { createPlatformAdapter } from '../../../../../apps/cloud/main/platform/index';
import { createFakeFs, createScriptedExec, darwinEnv, linuxEnv, OK, win32Env } from './fixtures';

function depsFor(env: PlatformEnv): PlatformAdapterDeps {
  return { env, fs: createFakeFs().fs, exec: createScriptedExec(() => OK).exec };
}

describe('createPlatformAdapter', () => {
  it('picks the darwin adapter on darwin', () => {
    const adapter = createPlatformAdapter(depsFor(darwinEnv()));
    expect(adapter.platform).toBe('darwin');
    expect(adapter.installLocations()).toEqual({ system: '/Applications', user: '/Users/test/Applications' });
  });

  it('picks the win32 adapter on win32', () => {
    const adapter = createPlatformAdapter(depsFor(win32Env()));
    expect(adapter.platform).toBe('win32');
    expect(adapter.installLocations().system).toBe('C:\\Program Files');
  });

  it('picks the linux adapter on linux', () => {
    const adapter = createPlatformAdapter(depsFor(linuxEnv()));
    expect(adapter.platform).toBe('linux');
    expect(adapter.installLocations()).toEqual({ user: '/home/test/Applications', system: '/opt' });
  });

  it('throws for an unsupported platform', () => {
    const env = { ...darwinEnv(), platform: 'freebsd' } as unknown as PlatformEnv;
    expect(() => createPlatformAdapter(depsFor(env))).toThrow(/Unsupported platform/);
  });
});
