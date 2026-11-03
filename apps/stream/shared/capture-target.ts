import type { CaptureKind, DesktopCaptureTarget, DesktopSourceOption } from './desktop-api';

export function normalizeCaptureTargetName(name: string): string {
  return name.slice(0, 512);
}

/** Snapshot of the durable clues available for one selected desktop source. */
export function captureTargetForOption(option: DesktopSourceOption): DesktopCaptureTarget {
  return {
    kind: option.kind,
    name: normalizeCaptureTargetName(option.name),
    ...(option.displayId ? { displayId: option.displayId } : {}),
    ...(option.appIconHash ? { appIconHash: option.appIconHash } : {}),
  };
}

/** Runtime validation for targets received across IPC or loaded from projects. */
export function isValidDesktopCaptureTarget(value: unknown): value is DesktopCaptureTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if ((target.kind !== 'screen' && target.kind !== 'window')
    || typeof target.name !== 'string' || target.name.length < 1 || target.name.length > 512) return false;
  if (target.displayId !== undefined && (target.kind !== 'screen' || typeof target.displayId !== 'string'
    || target.displayId.length < 1 || target.displayId.length > 256)) return false;
  if (target.appIconHash !== undefined && (target.kind !== 'window' || typeof target.appIconHash !== 'string'
    || !/^[a-f0-9]{64}$/i.test(target.appIconHash))) return false;
  return true;
}

function windowHandlePart(id: string): string | null {
  const match = /^window:([^:]+):[^:]+$/.exec(id);
  return match?.[1] ?? null;
}

/**
 * Resolves only strong, unique matches. Native source IDs are session handles;
 * they are accepted only when the current source still agrees with saved clues.
 */
export function resolveDesktopCaptureOption(
  options: readonly DesktopSourceOption[],
  kind: CaptureKind,
  captureId?: string,
  target?: DesktopCaptureTarget,
  legacySourceName?: string,
): DesktopSourceOption | null {
  const candidates = options.filter((option) => option.kind === kind);
  if (target && target.kind !== kind) return null;

  if (!target) {
    if (!captureId || !legacySourceName) return null;
    const exact = candidates.filter((option) => option.id === captureId && option.name === legacySourceName);
    return exact.length === 1 ? exact[0]! : null;
  }

  if (kind === 'screen') {
    if (target.displayId) {
      const matchingDisplay = candidates.filter((option) => option.displayId === target.displayId);
      return matchingDisplay.length === 1 ? matchingDisplay[0]! : null;
    }

    if (!captureId) return null;
    const exact = candidates.filter((option) => option.id === captureId
      && normalizeCaptureTargetName(option.name) === target.name);
    return exact.length === 1 ? exact[0]! : null;
  }

  if (captureId) {
    if (!target.appIconHash) {
      const exact = candidates.filter((option) => option.id === captureId
        && normalizeCaptureTargetName(option.name) === target.name);
      return exact.length === 1 ? exact[0]! : null;
    }

    const savedHandle = windowHandlePart(captureId);
    if (savedHandle !== null) {
      const sameHandle = candidates.filter((option) => windowHandlePart(option.id) === savedHandle);
      if (sameHandle.length > 1) return null;
      if (sameHandle.length === 1) {
        return sameHandle[0]!.appIconHash === target.appIconHash ? sameHandle[0]! : null;
      }
    }
  }

  if (!target.appIconHash) return null;
  const matchingWindow = candidates.filter((option) => normalizeCaptureTargetName(option.name) === target.name
    && option.appIconHash === target.appIconHash);
  return matchingWindow.length === 1 ? matchingWindow[0]! : null;
}
