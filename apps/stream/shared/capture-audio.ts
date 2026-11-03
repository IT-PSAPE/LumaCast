import type { StreamSource } from './desktop-api';
import type { AudioApplicationOption } from './desktop-api';
import type { StreamPlatform } from './platform-capabilities';

export type CaptureAudioMode = 'off' | 'system' | 'application';
export type SavedCaptureAudioMode = Exclude<CaptureAudioMode, 'off'>;

type CaptureAudioSource = Pick<StreamSource, 'captureAudioEnabled'> & {
  kind: StreamSource['kind'];
  captureAudioMode?: SavedCaptureAudioMode;
  captureAudioApplicationPath?: string;
};

export const WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE = 'Window-only audio is unavailable. Use a Browser source for isolated page audio.';

/** Legacy window settings may have requested app or system mix audio. */
export function hasWindowCaptureAudioIntent(source: CaptureAudioSource): boolean {
  return source.kind === 'window'
    && source.captureAudioEnabled !== false
    && (source.captureAudioEnabled === true || source.captureAudioMode !== undefined);
}

/** Resolve saved audio settings, keeping legacy system capture Windows-only. */
export function captureAudioModeForSource(source: CaptureAudioSource, platform: StreamPlatform): CaptureAudioMode {
  if (source.captureAudioEnabled === false) return 'off';
  if (source.kind === 'window') return 'off';
  if (source.captureAudioMode) return source.captureAudioMode;
  return source.captureAudioEnabled === true && platform === 'win32' ? 'system' : 'off';
}

/** Return a useful app label from the persisted executable path on either OS. */
export function captureAudioApplicationName(applicationPath: string | undefined): string | undefined {
  if (!applicationPath) return undefined;
  const name = applicationPath.split(/[\\/]/).filter(Boolean).at(-1);
  return name || undefined;
}

/** Resolve a saved executable path only when it names one live process. */
export function uniqueAudioApplicationForPath(
  applications: readonly AudioApplicationOption[],
  applicationPath: string | undefined,
  platform: StreamPlatform,
): AudioApplicationOption | null {
  if (!applicationPath) return null;
  const normalizePath = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  };
  const normalizedPath = normalizePath(applicationPath);
  const matches = applications.filter((application) => normalizePath(application.path) === normalizedPath);
  return matches.length === 1 ? matches[0]! : null;
}
