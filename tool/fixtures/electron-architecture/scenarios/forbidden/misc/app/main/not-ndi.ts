import native from '@lumacast/ndi-native';

export function tap(): void {
  native.send(null);
}