import { describe, expect, it } from 'vitest';
import { providerErrorMessage } from '../../../../apps/stream/renderer/features/shared/provider-error';

describe('providerErrorMessage', () => {
  it('hides Electron IPC wrappers and build environment names', () => {
    const raw = new Error("Error invoking remote method 'stream:connect-zoom-account': Error: Zoom account connection is not configured. Set LUMASTREAM_ZOOM_PUBLIC_CLIENT_ID and rebuild LumaStream.");
    const message = providerErrorMessage('Zoom', raw, 'Could not connect Zoom.');

    expect(message).toBe('Zoom sign-in is not available in this version of LumaStream. Contact your administrator to enable it.');
    expect(message).not.toMatch(/Error invoking|LUMASTREAM|rebuild/);
  });

  it('sanitizes YouTube setup failures passed as status messages', () => {
    const message = providerErrorMessage(
      'YouTube',
      "Error invoking remote method 'stream:connect-youtube-account': Error: YouTube account connection is not configured. Set LUMASTREAM_GOOGLE_CLIENT_ID and rebuild LumaStream.",
      'Could not connect YouTube.',
    );

    expect(message).toBe('YouTube sign-in is not available in this version of LumaStream. Contact your administrator to enable it.');
    expect(message).not.toMatch(/Error invoking|LUMASTREAM|GOOGLE_CLIENT_ID/);
  });

  it('keeps provider-specific permission and meeting validation guidance', () => {
    expect(providerErrorMessage('Zoom', new Error('Zoom denied access. Reconnect the account and confirm the app has the required meeting scopes.'), 'Zoom output failed.'))
      .toBe('Zoom could not access the account or meeting. Reconnect Zoom; if the issue continues, ask your administrator to check the app permissions.');
    expect(providerErrorMessage('Zoom', 'Choose a meeting start time in the future.', 'Zoom output failed.'))
      .toBe('Choose a meeting start time in the future.');
    expect(providerErrorMessage('YouTube', 'This YouTube channel is not enabled for live streaming. Check channel eligibility in YouTube Studio.', 'YouTube output failed.'))
      .toBe('This YouTube channel is not enabled for live streaming. Check channel eligibility in YouTube Studio.');
  });

  it('turns connection and secure-storage failures into next steps', () => {
    expect(providerErrorMessage('Zoom', new TypeError('fetch failed'), 'Zoom output failed.'))
      .toBe('Could not reach Zoom. Check your internet connection and try again.');
    expect(providerErrorMessage('YouTube', 'Secure credential storage is unavailable on this device, so YouTube cannot be connected safely.', 'YouTube output failed.'))
      .toBe('Secure credential storage is unavailable. Enable it on this device, then reconnect YouTube.');
  });

  it('uses the caller fallback for provider details that are not vetted', () => {
    const message = providerErrorMessage('Zoom', new Error('Zoom request failed: private response details at https://zoom.example/api'), 'Zoom could not load meetings. Try again.');

    expect(message).toBe('Zoom could not load meetings. Try again.');
    expect(message).not.toMatch(/private response|https:\/\//);
  });

  it('keeps sanitized provider messages on a second pass without accepting diagnostic suffixes', () => {
    const clean = providerErrorMessage('Zoom', 'Zoom denied access. Reconnect the account and confirm the app has the required meeting scopes.', 'Zoom output failed.');
    expect(providerErrorMessage('Zoom', clean, 'Zoom output failed.')).toBe(clean);

    const diagnostic = 'Could not reach Zoom. Check your internet connection and try again. https://private.example/?token=secret';
    expect(providerErrorMessage('Zoom', diagnostic, 'Zoom could not load meetings. Try again.'))
      .toBe('Could not reach Zoom. Check your internet connection and try again.');
    expect(providerErrorMessage('Zoom', diagnostic, 'Zoom output failed.')).not.toMatch(/private\.example|token=secret/);
  });

  it('accepts status objects with a message', () => {
    expect(providerErrorMessage('Zoom', { message: 'Connect a Zoom account before starting a Zoom output.' }, 'Zoom output failed.'))
      .toBe('Connect a Zoom account before starting output.');
  });
});
