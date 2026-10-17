export function allowsSpeakerSelection(
  permission: string,
  trustedRenderer: boolean,
  isMainFrame: boolean,
  trustedRequestingUrl: boolean,
): boolean {
  return permission === 'speaker-selection' && trustedRenderer && isMainFrame && trustedRequestingUrl;
}
