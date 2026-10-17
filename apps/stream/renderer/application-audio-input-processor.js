class StreamApplicationAudioInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.offset = 0;
    this.pendingSamples = 0;
    this.maxPendingSamples = sampleRate;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') {
        this.stopped = true;
        this.buffers = [];
        this.pendingSamples = 0;
        this.port.close();
        return;
      }
      if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength % 8 !== 0) return;
      let samples = new Float32Array(data);
      if (samples.length > this.maxPendingSamples) samples = samples.slice(samples.length - this.maxPendingSamples);
      this.buffers.push(samples);
      this.pendingSamples += samples.length;
      while (this.pendingSamples > this.maxPendingSamples && this.buffers.length > 0) {
        const oldest = this.buffers[0];
        const excess = this.pendingSamples - this.maxPendingSamples;
        const available = oldest.length - this.offset;
        if (available <= excess) {
          this.buffers.shift();
          this.pendingSamples -= available;
          this.offset = 0;
        } else {
          this.offset += excess;
          this.pendingSamples -= excess;
        }
      }
    };
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left) return true;
    left.fill(0);
    right?.fill(0);
    for (let frame = 0; frame < left.length; frame += 1) {
      while (this.buffers.length > 0 && this.offset >= this.buffers[0].length) {
        this.buffers.shift();
        this.offset = 0;
      }
      const samples = this.buffers[0];
      if (!samples) break;
      left[frame] = samples[this.offset++] ?? 0;
      if (right) right[frame] = samples[this.offset++] ?? 0;
      else this.offset += 1;
      this.pendingSamples -= 2;
    }
    return true;
  }
}

registerProcessor('stream-application-audio-input', StreamApplicationAudioInput);
