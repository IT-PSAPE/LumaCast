// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isProgramProjectorPopupUrl } from '../../../../apps/stream/main/navigation-policy';

describe('program projector navigation policy', () => {
  it('allows only the inherited-origin blank document used by the program projector', () => {
    expect(isProgramProjectorPopupUrl('about:blank')).toBe(true);
  });

  it('rejects every other popup destination', () => {
    for (const url of [
      '',
      'about:blank?streamWindow=program',
      'https://example.com/?streamWindow=program',
      'file:///C:/Program%20Files/LumaStream/index.html',
      'javascript:alert(1)',
    ]) {
      expect(isProgramProjectorPopupUrl(url)).toBe(false);
    }
  });
});
