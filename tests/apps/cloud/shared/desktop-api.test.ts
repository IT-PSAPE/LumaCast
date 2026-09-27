import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/cloud/main/app-identity';

const CONTRACT_PATH = path.resolve(__dirname, '../../../../apps/cloud/shared/desktop-api.ts');

describe('apps/cloud DesktopAPI contract', () => {
  const source = readFileSync(CONTRACT_PATH, 'utf8');

  it('declares exactly the capabilities the LumaCloud renderer uses', () => {
    // Scope the extraction to the `CloudDesktopAPI` interface body only —
    // matching any 2-space-indented `name:` line against the whole file
    // also picks up every other interface declared above it (HostInfo,
    // CloudSettings, OperationSnapshot, ...), whose fields (platform, arch,
    // cloudVersion, ...) are not renderer-facing API members at all.
    const interfaceMatch = source.match(/export interface CloudDesktopAPI \{([\s\S]*?)\n\}/);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch![1];
    const methods = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

    expect(methods).toEqual([
      'overview',
      'refresh',
      'releases',
      'grant',
      'revoke',
      'updateSettings',
      'install',
      'uninstall',
      'cancel',
      'operations',
      'open',
      'reveal',
      'openReleaseNotes',
      'checkForSelfUpdate',
      'installSelfUpdate',
      'onOverview',
      'onOperation',
    ]);
  });

  it('stays process-neutral, so main and the renderer can share it', () => {
    // A contract module is imported from both processes. Naming Electron or
    // a Node builtin here would drag a runtime into the renderer.
    expect(source).not.toMatch(/from ['"]electron['"]/);
    expect(source).not.toMatch(/from ['"]node:/);
  });

  it('takes its data types from the renderer-safe suite model', () => {
    expect(source).toContain("from '@lumacast/suite'");
  });

  it('is not the place the app identity lives, so the renderer never imports main', () => {
    // The contract may *mention* the app in prose; what it must not do is
    // import the identity, which would make the renderer depend on main.
    expect(source).not.toContain("from '../main");
    expect(source).not.toMatch(/from ['"][^'"]*app-identity['"]/);
    expect(source).not.toContain(APP_IDENTITY.id);
  });

  it('exposes exactly one global, and it is optional (absent before preload runs)', () => {
    expect(source).toMatch(/lumacloud\?:\s*CloudDesktopAPI/);
  });
});
