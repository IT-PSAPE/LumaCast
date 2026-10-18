import type { MenuEntry } from '@lumacast/ui';

// Pure menu model for the Audio Mixer dock's title-bar options button. Per the
// parity spec's decision, this button no longer opens global Settings — it
// opens this point-anchored menu instead.

export type MixerLayout = 'horizontal' | 'vertical';

export const MIXER_LAYOUT_STORAGE_KEY = 'lumastream.mixer-layout';

/** Parses a persisted layout value, defaulting to `'horizontal'` for anything else (including `null`/garbage). */
export function parseMixerLayout(raw: string | null | undefined): MixerLayout {
  return raw === 'vertical' ? 'vertical' : 'horizontal';
}

export interface BuildMixerMenuArgs {
  layout: MixerLayout;
  onToggleLayout: () => void;
  onOpenAdvancedAudio: () => void;
}

/** Entries for the mixer dock's title-bar options menu. */
export function buildMixerMenu({ layout, onToggleLayout, onOpenAdvancedAudio }: BuildMixerMenuArgs): MenuEntry[] {
  return [
    { id: 'mixer.advancedAudio', label: 'Advanced Audio Properties…', onSelect: onOpenAdvancedAudio },
    { separator: true },
    { id: 'mixer.verticalLayout', label: 'Vertical Layout', checked: layout === 'vertical', onSelect: onToggleLayout },
  ];
}
