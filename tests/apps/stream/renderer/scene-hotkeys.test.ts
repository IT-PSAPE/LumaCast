// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { removeSourceVisibilityHotkeys } from '../../../../apps/stream/renderer/scene-hotkeys';

describe('Stream source visibility hotkeys', () => {
  it('removes bindings for deleted sources and preserves the other bindings', () => {
    expect(removeSourceVisibilityHotkeys({
      camera: 'Control+Shift+1',
      microphone: 'Control+Shift+2',
    }, ['camera'])).toEqual({ microphone: 'Control+Shift+2' });
  });

  it('removes every source binding when a scene is deleted', () => {
    expect(removeSourceVisibilityHotkeys({
      sceneOneCamera: 'Control+Shift+1',
      sceneOneMic: 'Control+Shift+2',
      otherScene: 'Control+Shift+3',
    }, ['sceneOneCamera', 'sceneOneMic'])).toEqual({ otherScene: 'Control+Shift+3' });
  });
});
