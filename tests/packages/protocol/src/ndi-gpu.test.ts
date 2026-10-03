import { describe, expect, it } from 'vitest';
import { decodeNdiGpuSceneSnapshot, sceneVideoSource } from '../../../../packages/protocol/src/ndi-gpu';
function snapshot() {
  return { name: 'audience', revisionId: 'revision:1', scene: { width: 1920, height: 1080, slide: { id: 'slide' }, nodes: [] as unknown[] }, binding: { currentSlideText: null, nextSlideText: null, slideNotes: null, timerReadings: {} }, layerVideo: null as unknown };
}
function node() { return { id: 'node', element: { id: 'node', type: 'video', x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0, payload: { src: 'cast-media://managed/example.mp4' } }, visual: {} }; }
describe('GPU scene trust boundary', () => {
  it('accepts bounded scene, binding and video control data', () => {
    const value = snapshot(); value.scene.nodes = [node()]; value.layerVideo = { src: 'video', currentTime: 3, playing: true, loop: true, playbackRate: 2, observedAtMs: Date.now() };
    expect(decodeNdiGpuSceneSnapshot(value)).toMatchObject(value);
  });
  it.each([null, {}, { ...snapshot(), name: 'other' }, { ...snapshot(), revisionId: '' }, { ...snapshot(), scene: { width: Infinity, height: 1080, slide: {}, nodes: [] } }, { ...snapshot(), binding: { timerReadings: [] } }, { ...snapshot(), layerVideo: { src: 'video', currentTime: NaN } }])('rejects malformed envelopes %j', (value) => { expect(decodeNdiGpuSceneSnapshot(value)).toBeNull(); });
  it('bounds nodes and payload size without overflowing recursive traversal', () => {
    const value = snapshot(); value.scene.nodes = Array(10001).fill(node());
    expect(decodeNdiGpuSceneSnapshot(value)).toBeNull();
    const cyclic = { ...node(), children: [] as unknown[] }; cyclic.children.push(cyclic); value.scene.nodes = [cyclic];
    expect(decodeNdiGpuSceneSnapshot(value)).toBeNull();
    value.scene.nodes = []; value.binding.currentSlideText = 'x'.repeat(4 * 1024 * 1024) as never;
    expect(decodeNdiGpuSceneSnapshot(value)).toBeNull();
  });
  it('rejects invalid geometry and nested node count boundaries', () => {
    const value = snapshot(); value.scene.nodes = [{ ...node(), element: { ...node().element, width: NaN } }];
    expect(decodeNdiGpuSceneSnapshot(value)).toBeNull();
    value.scene.nodes = [{ ...node(), children: Array(10000).fill(node()) }];
    expect(decodeNdiGpuSceneSnapshot(value)).toBeNull();
  });
  it('finds a layer video inside a group', () => {
    expect(sceneVideoSource([{ ...node(), element: { ...node().element, type: 'group' }, children: [node()] }] as never, 'node')).toBe('cast-media://managed/example.mp4');
    expect(sceneVideoSource([], 'missing')).toBeNull();
  });
});
