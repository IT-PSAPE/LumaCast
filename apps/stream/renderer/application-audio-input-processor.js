class StreamApplicationAudioInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.offset = 0;
    this.sequence = 0;
    this.stopped = false;
    this.ready = false;
    this.port.onmessage = ({ data }) => {
      if (this.stopped) return;
      if (data?.type === 'stop') { this.stop(); return; }
      // These wire bounds match shared/application-audio-transport.ts. Keeping
      // receipts until consumption also bounds undelivered MessagePort tasks.
      if (data?.type !== 'pcm' || data.sequence !== this.sequence + 1
        || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength === 0
        || data.buffer.byteLength > 7680 || data.buffer.byteLength % 8
        || this.buffers.length >= 5 || sampleRate !== 48000) {
        this.port.postMessage({ type: 'error' });
        this.stop();
        return;
      }
      this.sequence = data.sequence;
      this.buffers.push({ samples: new Float32Array(data.buffer), sequence: data.sequence });
    };
  }

  stop() {
    this.stopped = true;
    this.buffers = [];
    this.offset = 0;
    this.port.close();
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    if (!this.ready) {
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    }
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left) return true;
    left.fill(0);
    right?.fill(0);
    for (let frame = 0; frame < left.length; frame += 1) {
      const packet = this.buffers[0];
      if (!packet) break;
      left[frame] = packet.samples[this.offset++];
      if (right) right[frame] = packet.samples[this.offset++];
      else this.offset += 1;
      if (this.offset === packet.samples.length) {
        this.buffers.shift();
        this.offset = 0;
        this.port.postMessage({ type: 'consumed', sequence: packet.sequence });
      }
    }
    return true;
  }
}

registerProcessor('stream-application-audio-input', StreamApplicationAudioInput);
