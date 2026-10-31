class StreamNdiOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const left = input?.[0];
    if (!left) return true;
    const right = input[1] ?? left;
    for (let i = 0; i < left.length; i++) {
      this.samples[this.offset] = left[i];
      this.samples[1024 + this.offset] = right[i];
      if (++this.offset === 1024) {
        this.port.postMessage({ data: this.samples, sampleRate, channels: 2, samplesPerChannel: 1024 }, [this.samples.buffer]);
        this.samples = new Float32Array(2048);
        this.offset = 0;
      }
    }
    // Outputs deliberately stay silent; this node publishes the chosen mix only.
    return true;
  }
}
registerProcessor('stream-ndi-output', StreamNdiOutput);
