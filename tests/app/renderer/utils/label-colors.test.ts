import { describe, expect, it } from 'vitest';
import { getLabelColors, LABEL_COLOR_OPTIONS } from '../../../../app/renderer/utils/label-colors';

describe('label colors', () => {
  it('uses the separator palette and returns a translucent caption background', () => {
    expect(LABEL_COLOR_OPTIONS.map((option) => option.key)).toContain('blue');
    expect(getLabelColors('blue')).toEqual({
      backgroundColor: 'rgba(59, 130, 246, 0.18)',
      color: 'color-mix(in srgb, var(--text-color-primary) 88%, #3b82f6)',
    });
  });

  it('leaves untagged captions on their normal background', () => {
    expect(getLabelColors(null)).toBeNull();
    expect(getLabelColors('not-a-color')).toBeNull();
  });
});
