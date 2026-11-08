// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { APPLICATION_AUDIO_PACKET_BYTES, APPLICATION_AUDIO_WINDOW_PACKETS } from '../../../../apps/stream/shared/application-audio-transport';

function processor() {
  let Constructor: any;
  vm.runInNewContext(readFileSync('apps/stream/renderer/application-audio-input-processor.js', 'utf8'), {
    ArrayBuffer, Float32Array, sampleRate: 48000,
    AudioWorkletProcessor: class { port = { onmessage: null, sent: [] as unknown[], postMessage(data: unknown) { this.sent.push(data); }, close() {} }; },
    registerProcessor: (_name: string, value: any) => { Constructor = value; },
  });
  const node = new Constructor();
  node.process([], [[new Float32Array(128), new Float32Array(128)]]);
  expect(node.port.sent).toEqual([{ type: 'ready' }]);
  node.port.sent.length = 0;
  return node;
}
function send(node: any, sequence: number, frames: number, value = sequence) {
  const samples = new Float32Array(frames * 2).fill(value);
  node.port.onmessage({ data: { type: 'pcm', sequence, buffer: samples.buffer } });
}
function render(node: any) {
  const output = [new Float32Array(128), new Float32Array(128)];
  const running = node.process([], [output]);
  return { running, left: output[0]!, right: output[1]! };
}
describe('application audio worklet consumption', () => {
  it('acknowledges only after each final stereo frame, across quantum boundaries', () => {
    const node = processor();
    send(node, 1, APPLICATION_AUDIO_PACKET_BYTES / 8);
    send(node, 2, 128);
    for (let i = 0; i < 7; ++i) {
      expect([...render(node).left]).toEqual(Array(128).fill(1));
      expect(node.port.sent).toEqual([]);
    }
    const crossing = render(node);
    expect([...crossing.left]).toEqual([...Array(64).fill(1), ...Array(64).fill(2)]);
    expect([...crossing.right]).toEqual([...crossing.left]);
    expect(node.port.sent).toEqual([{ type: 'consumed', sequence: 1 }]);
    expect([...render(node).left]).toEqual([...Array(64).fill(2), ...Array(64).fill(0)]);
    expect(node.port.sent).toEqual([{ type: 'consumed', sequence: 1 }, { type: 'consumed', sequence: 2 }]);
  });
  it('fails rather than trimming a sixth unconsumed packet', () => {
    const node = processor();
    for (let i = 1; i <= APPLICATION_AUDIO_WINDOW_PACKETS; ++i) send(node, i, 960);
    expect(node.buffers).toHaveLength(5);
    send(node, 6, 960);
    expect(node.port.sent).toEqual([{ type: 'error' }]);
    expect(node.buffers).toEqual([]);
    expect(render(node).running).toBe(false);
    send(node, 7, 960);
    expect(node.port.sent).toHaveLength(1);
  });
  it.each([0, 1, 4, 7688])('rejects invalid packet byte length %s', (length) => {
    const node = processor();
    node.port.onmessage({ data: { type: 'pcm', sequence: 1, buffer: new ArrayBuffer(length) } });
    expect(node.port.sent).toEqual([{ type: 'error' }]);
  });
});
