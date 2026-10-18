import { describe, expect, it } from 'vitest';
import { PROJECTOR_WINDOW_NAMES, projectorTitleForFrameName } from '../../../../apps/stream/shared/projector';

describe('Stream projector window identity', () => {
  it('uses distinct names and titles for Preview and Program', () => {
    expect(PROJECTOR_WINDOW_NAMES.preview).not.toBe(PROJECTOR_WINDOW_NAMES.program);
    expect(projectorTitleForFrameName(PROJECTOR_WINDOW_NAMES.preview)).toBe('LumaStream Preview');
    expect(projectorTitleForFrameName(PROJECTOR_WINDOW_NAMES.program)).toBe('LumaStream Program');
  });

  it('uses a distinct name and title for Multiview', () => {
    expect(PROJECTOR_WINDOW_NAMES.multiview).not.toBe(PROJECTOR_WINDOW_NAMES.preview);
    expect(PROJECTOR_WINDOW_NAMES.multiview).not.toBe(PROJECTOR_WINDOW_NAMES.program);
    expect(projectorTitleForFrameName(PROJECTOR_WINDOW_NAMES.multiview)).toBe('Multiview');
  });

  it('uses a generic title for other about:blank windows', () => {
    expect(projectorTitleForFrameName('unrecognized-window')).toBe('LumaStream Projector');
  });
});
