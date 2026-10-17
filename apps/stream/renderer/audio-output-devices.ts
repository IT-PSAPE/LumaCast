export interface AudioOutputDeviceOption {
  deviceId: string;
  label: string;
}

export function audioOutputDeviceOptions(devices: readonly Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]): AudioOutputDeviceOption[] {
  return devices.filter((device) => device.kind === 'audiooutput' && device.deviceId !== '' && device.deviceId !== 'default')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Audio output ${index + 1}` }));
}
