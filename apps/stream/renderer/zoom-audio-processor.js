class ZoomPcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.packetFrames = 960;
    this.channels = 2;
    this.cursor = 0;
    this.packet = new Int16Array(this.packetFrames * this.channels);
    this.inFlight = 0;
    this.queued = [];
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'ack') return;
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.flushQueue();
    };
  }

  process(inputs) {
    const input = inputs[0];
    const left = input?.[0];
    const right = input?.[1] ?? left;
    if (!left) return true;
    for (let frame = 0; frame < left.length; frame += 1) {
      this.packet[this.cursor * 2] = this.toInt16(left[frame]);
      this.packet[this.cursor * 2 + 1] = this.toInt16(right?.[frame] ?? 0);
      this.cursor += 1;
      if (this.cursor === this.packetFrames) {
        this.publish(this.packet);
        this.packet = new Int16Array(this.packetFrames * this.channels);
        this.cursor = 0;
      }
    }
    return true;
  }

  toInt16(sample) {
    const value = Math.max(-1, Math.min(1, sample));
    return value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }

  publish(packet) {
    if (this.inFlight < 4) {
      this.send(packet);
      return;
    }
    if (this.queued.length >= 20) this.queued.shift();
    this.queued.push(packet);
  }

  send(packet) {
    const buffer = packet.buffer;
    this.inFlight += 1;
    this.port.postMessage({ type: 'audio', data: buffer, sampleRate: 48000, channels: this.channels }, [buffer]);
  }

  flushQueue() {
    while (this.inFlight < 4 && this.queued.length > 0) this.send(this.queued.shift());
  }
}

registerProcessor('lumastream-zoom-pcm16', ZoomPcm16Processor);
