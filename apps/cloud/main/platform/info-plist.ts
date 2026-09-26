// A minimal Info.plist reader: just enough to pull the three keys the darwin
// adapter needs out of the XML plist electron-builder writes into every mac
// bundle's Contents/Info.plist. Not a general plist parser: it only resolves
// <key>/<string> pairs, which is the type electron-builder uses for all three
// keys below (CFBundleVersion and CFBundleShortVersionString are written as
// strings, not <real>/<integer>, even though they look numeric).

export interface InfoPlistValues {
  bundleId: string | null;
  shortVersion: string | null;
  version: string | null;
}

const KEY_STRING_PATTERN = /<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function readInfoPlist(xml: string): InfoPlistValues {
  const values = new Map<string, string>();
  const pattern = new RegExp(KEY_STRING_PATTERN);
  let match: RegExpExecArray | null = pattern.exec(xml);
  while (match !== null) {
    values.set(decodeXmlEntities(match[1]), decodeXmlEntities(match[2]));
    match = pattern.exec(xml);
  }
  return {
    bundleId: values.get('CFBundleIdentifier') ?? null,
    shortVersion: values.get('CFBundleShortVersionString') ?? null,
    version: values.get('CFBundleVersion') ?? null,
  };
}
