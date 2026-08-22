import type { SceneSurface } from '@lumacast/composition';

export function buildVideoNodeClaimKey(surface: SceneSurface, elementId: string): string {
  return `${surface}:node:${elementId}`;
}

export function buildVideoBackgroundClaimKey(surface: SceneSurface, ownerId: string): string {
  return `${surface}:background:${ownerId}`;
}
