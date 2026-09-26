import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_USER_DATA_DIR_NAME,
  PACKAGED_USER_DATA_DIR_NAME,
  resolveUserData,
} from '../../../../apps/chord/main/user-data';

const APP_DATA = path.join(path.sep, 'Users', 'tester', 'Library', 'Application Support');

describe('apps/chord user data resolution', () => {
  it('uses the product name for the packaged directory', () => {
    const plan = resolveUserData({ packaged: true, appData: APP_DATA });

    expect(plan.name).toBe('LumaChord');
    expect(PACKAGED_USER_DATA_DIR_NAME).toBe('LumaChord');
    expect(plan.dir).toBe(path.join(APP_DATA, 'LumaChord'));
  });

  it('uses the lowercase developer directory in dev', () => {
    const plan = resolveUserData({ packaged: false, appData: APP_DATA });

    expect(plan.name).toBe(DEV_USER_DATA_DIR_NAME);
    expect(plan.dir).toBe(path.join(APP_DATA, DEV_USER_DATA_DIR_NAME));
    expect(plan.dir).toBe(path.join(APP_DATA, 'lumachord'));
  });

  it('gives the two modes different directories so a dev run cannot edit a packaged install', () => {
    const packaged = resolveUserData({ packaged: true, appData: APP_DATA });
    const dev = resolveUserData({ packaged: false, appData: APP_DATA });

    expect(packaged.dir).not.toBe(dev.dir);
  });

  it('never derives the directory from the scoped npm package name', () => {
    const plan = resolveUserData({ packaged: true, appData: APP_DATA });

    expect(plan.dir).not.toContain('@lumacast');
    expect(plan.dir).not.toContain('chord@');
  });

  it('lets LUMACHORD_DATA_DIR win outright, in both modes', () => {
    const override = path.join(path.sep, 'tmp', 'lumachord-e2e', 'data');

    expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).dir).toBe(override);
    expect(resolveUserData({ packaged: false, appData: APP_DATA, override }).dir).toBe(override);
  });

  it('keeps the app name following the packaged/dev rule even under an override', () => {
    const override = path.join(path.sep, 'tmp', 'lumachord-e2e', 'data');

    expect(resolveUserData({ packaged: false, appData: APP_DATA, override }).name).toBe('lumachord');
    expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).name).toBe('LumaChord');
  });

  it('ignores an empty override instead of resolving to the current directory', () => {
    for (const override of ['', undefined]) {
      expect(resolveUserData({ packaged: true, appData: APP_DATA, override }).dir).toBe(
        path.join(APP_DATA, PACKAGED_USER_DATA_DIR_NAME),
      );
    }
  });
});
