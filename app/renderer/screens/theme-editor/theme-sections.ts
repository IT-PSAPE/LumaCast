import type { ThemeOwnerType } from '@lumacast/composition';

export const THEME_SECTIONS: ReadonlyArray<{ type: ThemeOwnerType; label: string }> = [
  { type: 'presentation', label: 'Presentations' },
  { type: 'lyric', label: 'Lyrics' },
  { type: 'talk', label: 'Talks' },
  { type: 'overlay', label: 'Overlays' },
];

export function singular(label: string): string {
  return label.replace(/s$/, '').toLowerCase();
}
