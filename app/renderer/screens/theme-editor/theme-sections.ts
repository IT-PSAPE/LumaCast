import type { ThemeOwnerType } from '@lumacast/composition';

// Overlay themes are removed from the UI: overlay single-slide and duplicate
// overlay serve reuse; overlay themes had no persistent themeId linkage.
// Legacy overlay_themes records remain readable in the snapshot for compat.
export const THEME_SECTIONS: ReadonlyArray<{ type: ThemeOwnerType; label: string }> = [
  { type: 'presentation', label: 'Presentations' },
  { type: 'lyric', label: 'Lyrics' },
];

export function singular(label: string): string {
  return label.replace(/s$/, '').toLowerCase();
}
