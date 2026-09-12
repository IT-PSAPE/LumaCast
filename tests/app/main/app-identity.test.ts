import { describe, expect, it } from 'vitest';
import { resolveAppIdentity } from '../../../app/main/app-identity';

describe('resolveAppIdentity', () => {
  it('uses configured development identity values', () => {
    expect(resolveAppIdentity({
      MAIN_VITE_APP_NAME: 'LumaCast Dev',
      MAIN_VITE_APP_ID: 'com.lumacast.app.dev',
    })).toEqual({ name: 'LumaCast Dev', id: 'com.lumacast.app.dev' });
  });

  it('falls back to the production identity', () => {
    expect(resolveAppIdentity({})).toEqual({ name: 'LumaCast', id: 'com.lumacast.app' });
  });
});
