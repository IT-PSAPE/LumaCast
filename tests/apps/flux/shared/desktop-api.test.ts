import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/flux/main/app-identity';

const CONTRACT_PATH = path.resolve(__dirname, '../../../../apps/flux/shared/desktop-api.ts');

describe('apps/flux DesktopAPI contract', () => {
  const source = readFileSync(CONTRACT_PATH, 'utf8');

  it('declares exactly the capabilities the Lumaflux screens use', () => {
    const methods = [...source.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);

    expect(methods).toEqual([
      'command',
      'chooseImport',
      'chooseDirectory',
      'chooseRelink',
      'preview',
      'assetUrl',
      'pathsForFiles',
      'onChange',
      'settings',
      'updateSettings',
    ]);
  });

  it('stays process-neutral, so main and the renderer can share it', () => {
    // A contract module is imported from both processes. Naming Electron, a
    // Node builtin, or a Node-side photo package here would drag a runtime into
    // one of them.
    expect(source).not.toMatch(/from ['"]electron['"]/);
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toContain('@lumacast/photo-imaging');
    expect(source).not.toContain('@lumacast/photo-library');
  });

  it('takes its data types from the renderer-safe photo domain model', () => {
    expect(source).toContain("from '@lumacast/photo-model'");
  });

  it('is not the place the app identity lives, so the renderer never imports main', () => {
    // The contract may *mention* the app in prose; what it must not do is import
    // the identity, which would make the renderer depend on main. Matching the
    // bare product name instead would fail on that prose, so the check is
    // scoped to imports.
    expect(source).not.toContain("from '../main");
    expect(source).not.toMatch(/from ['"][^'"]*app-identity['"]/);
    expect(source).not.toContain(APP_IDENTITY.id);
  });
});
