import { describe, expect, it } from 'vitest';
import { audioOutputDeviceOptions } from '../../../../apps/stream/renderer/audio-output-devices';

describe('audio output device list', () => {
  it('lists named audio outputs and omits the implicit system default device', () => {
    expect(audioOutputDeviceOptions([
      { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
      { kind: 'audiooutput', deviceId: 'usb-dac', label: 'USB DAC' },
      { kind: 'audioinput', deviceId: 'microphone', label: 'Microphone' },
    ])).toEqual([{ deviceId: 'usb-dac', label: 'USB DAC' }]);
  });

  it('labels outputs whose names are hidden by the browser', () => {
    expect(audioOutputDeviceOptions([
      { kind: 'audiooutput', deviceId: 'device-a', label: '' },
      { kind: 'audiooutput', deviceId: '', label: 'Hidden device' },
    ])).toEqual([{ deviceId: 'device-a', label: 'Audio output 1' }]);
  });
});
