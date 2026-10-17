// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isProjectorPopupUrl } from '../../../../apps/stream/main/navigation-policy';

describe('projector navigation policy', () => {
  it('allows only the inherited-origin blank document used by projector windows', () => {
    expect(isProjectorPopupUrl('about:blank')).toBe(true);
  });

  it('rejects every other popup destination', () => {
    for (const url of [
      '',
      'about:blank?streamWindow=program',
      'https://example.com/?streamWindow=program',
      'file:///C:/Program%20Files/LumaStream/index.html',
      'javascript:alert(1)',
    ]) {
      expect(isProjectorPopupUrl(url)).toBe(false);
    }
  });
});
