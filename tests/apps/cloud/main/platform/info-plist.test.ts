import { describe, expect, it } from 'vitest';
import { readInfoPlist } from '../../../../../apps/cloud/main/platform/info-plist';

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>`;
}

describe('readInfoPlist', () => {
  it('reads CFBundleIdentifier, CFBundleShortVersionString, and CFBundleVersion', () => {
    const xml = plist(`
	<key>CFBundleIdentifier</key>
	<string>com.lumacast.app</string>
	<key>CFBundleShortVersionString</key>
	<string>1.2.3</string>
	<key>CFBundleVersion</key>
	<string>1.2.3</string>
	<key>CFBundleName</key>
	<string>LumaCast</string>
`);
    expect(readInfoPlist(xml)).toEqual({
      bundleId: 'com.lumacast.app',
      shortVersion: '1.2.3',
      version: '1.2.3',
    });
  });

  it('returns null for every key missing from the plist', () => {
    const xml = plist(`
	<key>CFBundleName</key>
	<string>LumaCast</string>
`);
    expect(readInfoPlist(xml)).toEqual({
      bundleId: null,
      shortVersion: null,
      version: null,
    });
  });

  it('decodes XML entities in string values', () => {
    const xml = plist(`
	<key>CFBundleIdentifier</key>
	<string>com.lumacast.app</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0.0 &amp; friends</string>
	<key>CFBundleVersion</key>
	<string>1.0.0</string>
`);
    expect(readInfoPlist(xml).shortVersion).toBe('1.0.0 & friends');
  });

  it('ignores non-string values (only <key>/<string> pairs are read)', () => {
    const xml = plist(`
	<key>CFBundleIdentifier</key>
	<string>com.lumacast.app</string>
	<key>LSMinimumSystemVersion</key>
	<real>10.15</real>
	<key>CFBundleShortVersionString</key>
	<string>2.0.0</string>
	<key>CFBundleVersion</key>
	<string>2.0.0</string>
`);
    const result = readInfoPlist(xml);
    expect(result.bundleId).toBe('com.lumacast.app');
    expect(result.shortVersion).toBe('2.0.0');
  });

  it('is stateless across repeated calls (no lastIndex leakage from the global regex)', () => {
    const first = plist(`
	<key>CFBundleIdentifier</key>
	<string>com.lumacast.app</string>
`);
    const second = plist(`
	<key>CFBundleIdentifier</key>
	<string>com.lumacast.cloud</string>
`);
    expect(readInfoPlist(first).bundleId).toBe('com.lumacast.app');
    expect(readInfoPlist(second).bundleId).toBe('com.lumacast.cloud');
    expect(readInfoPlist(first).bundleId).toBe('com.lumacast.app');
  });
});
