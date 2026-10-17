class LumaStreamAudioFilters extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.settings = {
      enabled: false,
      openThresholdDb: -26,
      closeThresholdDb: -32,
      attackMs: 10,
      holdMs: 150,
      releaseMs: 250,
      expanderEnabled: false,
      expanderThresholdDb: -40,
      expanderRatio: 2,
      expanderAttackMs: 10,
      expanderReleaseMs: 150,
      ...(options.processorOptions ?? {}),
    };
    this.open = true;
    this.holdSamples = 0;
    this.gain = 1;
    this.expanderGain = 1;
    this.port.onmessage = (event) => {
      this.settings = { ...this.settings, ...event.data };
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const sampleCount = output[0]?.length ?? 128;
    let energy = 0;
    let measuredSamples = 0;
    for (const channel of input) {
      for (let index = 0; index < channel.length; index += 1) energy += channel[index] * channel[index];
      measuredSamples += channel.length;
    }

    const levelDb = measuredSamples > 0 ? 20 * Math.log10(Math.max(1e-8, Math.sqrt(energy / measuredSamples))) : -160;
    if (!this.settings.enabled) {
      this.open = true;
      this.holdSamples = 0;
    } else if (levelDb >= this.settings.openThresholdDb) {
      this.open = true;
      this.holdSamples = Math.round(this.settings.holdMs * sampleRate / 1000);
    } else if (this.open) {
      if (levelDb >= this.settings.closeThresholdDb) this.holdSamples = Math.round(this.settings.holdMs * sampleRate / 1000);
      else {
        this.holdSamples -= sampleCount;
        if (this.holdSamples <= 0) this.open = false;
      }
    }

    const targetGain = this.open ? 1 : 0;
    const transitionMs = this.open ? this.settings.attackMs : this.settings.releaseMs;
    const coefficient = Math.exp(-1 / Math.max(1, sampleRate * transitionMs / 1000));
    const belowThresholdDb = levelDb - this.settings.expanderThresholdDb;
    const expanderAttenuationDb = this.settings.expanderEnabled && belowThresholdDb < 0
      ? Math.max(-60, belowThresholdDb * (this.settings.expanderRatio - 1))
      : 0;
    const targetExpanderGain = 10 ** (expanderAttenuationDb / 20);
    const expanderTransitionMs = targetExpanderGain < this.expanderGain
      ? this.settings.expanderAttackMs
      : this.settings.expanderReleaseMs;
    const expanderCoefficient = Math.exp(-1 / Math.max(1, sampleRate * expanderTransitionMs / 1000));
    for (let index = 0; index < sampleCount; index += 1) {
      this.gain = targetGain + (this.gain - targetGain) * coefficient;
      this.expanderGain = targetExpanderGain + (this.expanderGain - targetExpanderGain) * expanderCoefficient;
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        output[channelIndex][index] = (input[channelIndex]?.[index] ?? 0) * this.gain * this.expanderGain;
      }
    }
    return true;
  }
}

registerProcessor('lumastream-audio-filters', LumaStreamAudioFilters);
