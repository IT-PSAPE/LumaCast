import type { CaptureCursorMode, DesktopSourceOption, StreamSource } from '../shared/desktop-api';
import { captureTargetForOption } from '../shared/capture-target';

export type DesktopCaptureBindingMode = 'manual' | 'automatic-restore';

function sameTargetClues(source: StreamSource, option: DesktopSourceOption): boolean {
  if (source.captureId !== option.id) return false;
  if (source.captureTarget) {
    const target = captureTargetForOption(option);
    return source.captureTarget.kind === target.kind
      && source.captureTarget.name === target.name
      && (source.captureTarget.displayId === undefined || target.displayId === undefined
        || source.captureTarget.displayId === target.displayId)
      && (source.captureTarget.appIconHash === undefined || target.appIconHash === undefined
        || source.captureTarget.appIconHash === target.appIconHash);
  }
  return source.captureId === option.id && source.name === option.name;
}

/** Rebinds a saved display/window source without discarding its scene properties. */
export function bindDesktopCaptureSource(
  source: StreamSource,
  option: DesktopSourceOption,
  cursorMode: CaptureCursorMode,
  mode: DesktopCaptureBindingMode = 'manual',
): StreamSource {
  const expectedKind = source.kind === 'display' ? 'screen' : source.kind === 'window' ? 'window' : null;
  if (!expectedKind || option.kind !== expectedKind) throw new Error('The selected capture source type does not match.');

  const captureBindingId = mode === 'automatic-restore'
    ? source.captureBindingId
    : sameTargetClues(source, option) ? source.captureBindingId : crypto.randomUUID();
  return {
    ...source,
    ...(captureBindingId ? { captureBindingId } : {}),
    captureId: option.id,
    captureTarget: captureTargetForOption(option),
    cursorMode,
  };
}
