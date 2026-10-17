import type { StreamSource } from '../shared/desktop-api';

function isAudioOnly(source: StreamSource): boolean {
  return source.kind === 'microphone' || source.kind === 'desktop-audio' || source.kind === 'application-audio'
    || (source.kind === 'media' && source.mediaKind === 'audio');
}

/** Flattens visible group contents in stacking order and carries inherited group opacity. */
export function getRenderableSources(sources: readonly StreamSource[]): StreamSource[] {
  const rendered: StreamSource[] = [];
  const visit = (items: readonly StreamSource[]) => {
    for (const source of items) {
      if (!source.visible) continue;
      if (source.kind === 'group') {
        visit(source.children ?? []);
      } else if (!isAudioOnly(source)) rendered.push(source);
    }
  };
  visit(sources);
  return rendered;
}
