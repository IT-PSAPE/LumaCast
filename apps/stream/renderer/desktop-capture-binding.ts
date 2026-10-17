import type { CaptureCursorMode, DesktopSourceOption, StreamSource } from '../shared/desktop-api';

/** Rebinds a saved display/window source without discarding its scene properties. */
export function bindDesktopCaptureSource(
  source: StreamSource,
  option: DesktopSourceOption,
  cursorMode: CaptureCursorMode,
): StreamSource {
  const expectedKind = source.kind === 'display' ? 'screen' : source.kind === 'window' ? 'window' : null;
  if (!expectedKind || option.kind !== expectedKind) throw new Error('The selected capture source type does not match.');
  return { ...source, captureId: option.id, cursorMode };
}
