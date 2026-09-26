import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_USER_DATA_DIR_NAME,
  PACKAGED_USER_DATA_DIR_NAME,
  resolveUserData,
} from '../../../../apps/flux/main/user-data';

const APP_DATA = path.join(path.sep, 'Users', 'tester', 'Library', 'Application Support');

describe('apps/flux user data resolution', () => {
  it('keeps the packaged directory that existing installs already use', () => {
    const plan = resolveUserData({ packaged: true, appData: APP_DATA });

    // Changing this would orphan every existing library, catalog, and settings
    // file, so the exact historical name is pinned here. It is the product name
    // (`Lumaflux`); `LumaFlux` is a different directory and must never appear.
    expect(plan.name).toBe('Lumaflux');
    expect(PACKAGED_USER_DATA_DIR_NAME).toBe('Lumaflux');
    expect(plan.dir).toBe(path.join(APP_DATA, 'Lumaflux'));
  });

  it('never uses the internal-cased spelling for the packaged directory', () => {
    const plan = resolveUserData({ packaged: true, appData: APP_DATA });

    // `LumaFlux` is one letter away and is a *different* directory, so it would
    // silently orphan an existing library rather than fail loudly.
    expect(plan.dir).not.toBe(path.join(APP_DATA, 'LumaFlux'));
    expect(PACKAGED_USER_DATA_DIR_NAME).not.toBe('LumaFlux');
  });

  it('keeps the lowercase developer directory the source checkout used', () => {
    const plan = resolveUserData({ packaged: false, appData: APP_DATA });

    expect(plan.name).toBe(DEV_USER_DATA_DIR_NAME);
    expect(plan.dir).toBe(path.join(APP_DATA, DEV_USER_DATA_DIR_NAME));
    expect(plan.dir).toBe(path.join(APP_DATA, 'lumaflux'));
  });

  it('gives the two modes different directories so a dev run cannot edit a packaged library', () => {
    const packaged = resolveUserData({ packaged: true, appData: APP_DATA });
    const dev = resolveUserData({ packaged: false, appData: APP_DATA });

    expect(packaged.dir).not.toBe(dev.dir);
  });

  it('never derives the directory from the scoped npm package name', () => {
    const plan = resolveUserData({ packaged: true, appData: APP_DATA });

    expect(plan.dir).not.toContain('@lumacast');
    expect(plan.dir).not.toContain('flux@');
  });

  it('lets LUMAFLUX_DATA_DIR win outright, in both modes', () => {
    const override = path.join(path.sep, 'tmp', 'lumaflux-e2e', 'data');

    expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).dir).toBe(override);
    expect(resolveUserData({ packaged: false, appData: APP_DATA, override }).dir).toBe(override);
  });

  it('keeps the app name following the packaged/dev rule even under an override', () => {
    const override = path.join(path.sep, 'tmp', 'lumaflux-e2e', 'data');

    expect(resolveUserData({ packaged: false, appData: APP_DATA, override }).name).toBe('lumaflux');
    expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).name).toBe('Lumaflux');
  });

  it('ignores an empty override instead of resolving to the current directory', () => {
    for (const override of ['', undefined]) {
      expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).dir).toBe(
        path.join(APP_DATA, PACKAGED_USER_DATA_DIR_NAME),
      );
    }
  });
});
