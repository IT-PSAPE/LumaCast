import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem } from '@lumacast/ui';
import { buildMixerMenu, MIXER_LAYOUT_STORAGE_KEY, parseMixerLayout } from '../../../../apps/stream/renderer/docks/mixer-menu';

function isItem(entry: MenuEntry): entry is MenuItem {
  return 'id' in entry;
}

function findItem(entries: MenuEntry[], id: string): MenuItem {
  const found = entries.find((entry) => isItem(entry) && entry.id === id);
  if (!found || !isItem(found)) throw new Error(`menu item not found: ${id}`);
  return found;
}

describe('parseMixerLayout', () => {
  it('parses the persisted "vertical" value', () => {
    expect(parseMixerLayout('vertical')).toBe('vertical');
  });

  it('defaults to "horizontal" for null, unknown values, and garbage', () => {
    expect(parseMixerLayout(null)).toBe('horizontal');
    expect(parseMixerLayout(undefined)).toBe('horizontal');
    expect(parseMixerLayout('horizontal')).toBe('horizontal');
    expect(parseMixerLayout('')).toBe('horizontal');
    expect(parseMixerLayout('garbage')).toBe('horizontal');
  });

  it('exposes a stable storage key', () => {
    expect(MIXER_LAYOUT_STORAGE_KEY).toBe('lumastream.mixer-layout');
  });
});

describe('buildMixerMenu', () => {
  it('includes Advanced Audio Properties, a separator, then Vertical Layout', () => {
    const entries = buildMixerMenu({ layout: 'horizontal', onToggleLayout: vi.fn(), onOpenAdvancedAudio: vi.fn() });
    expect(entries).toHaveLength(3);
    expect('separator' in entries[1] && entries[1].separator).toBe(true);

    const advanced = findItem(entries, 'mixer.advancedAudio');
    expect(advanced.label).toBe('Advanced Audio Properties…');

    const vertical = findItem(entries, 'mixer.verticalLayout');
    expect(vertical.label).toBe('Vertical Layout');
  });

  it('checks Vertical Layout only when the layout is vertical', () => {
    const horizontalEntries = buildMixerMenu({ layout: 'horizontal', onToggleLayout: vi.fn(), onOpenAdvancedAudio: vi.fn() });
    expect(findItem(horizontalEntries, 'mixer.verticalLayout').checked).toBe(false);

    const verticalEntries = buildMixerMenu({ layout: 'vertical', onToggleLayout: vi.fn(), onOpenAdvancedAudio: vi.fn() });
    expect(findItem(verticalEntries, 'mixer.verticalLayout').checked).toBe(true);
  });

  it('wires onSelect to the given callbacks', () => {
    const onToggleLayout = vi.fn();
    const onOpenAdvancedAudio = vi.fn();
    const entries = buildMixerMenu({ layout: 'horizontal', onToggleLayout, onOpenAdvancedAudio });

    findItem(entries, 'mixer.advancedAudio').onSelect?.();
    expect(onOpenAdvancedAudio).toHaveBeenCalledTimes(1);
    expect(onToggleLayout).not.toHaveBeenCalled();

    findItem(entries, 'mixer.verticalLayout').onSelect?.();
    expect(onToggleLayout).toHaveBeenCalledTimes(1);
  });
});
