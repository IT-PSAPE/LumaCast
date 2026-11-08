/** Split pasted lyric text into non-empty slide lines. */
export function parseLyricImportText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n');

  return normalized
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
