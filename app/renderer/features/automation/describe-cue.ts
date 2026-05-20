import type { Cue, CueClearLayer, CueKind, Id, MediaAsset, Overlay, Stage } from '@core/types';

export const CUE_KIND_LABELS: Record<CueKind, string> = {
  'overlay.activate': 'Activate overlay',
  'overlay.clear': 'Clear overlay',
  'overlay.clearAll': 'Clear all overlays',
  'mediaLayer.set': 'Set media layer',
  'video.arm': 'Arm video',
  'video.clear': 'Clear video',
  'audio.arm': 'Arm audio',
  'audio.clear': 'Clear audio',
  'stage.set': 'Set stage',
  'stage.clear': 'Clear stage',
  'layer.clear': 'Clear layer',
  'layer.clearAll': 'Clear all layers',
  'flow.wait': 'Wait',
};

export interface DescribeCueContext {
  overlays: Pick<Overlay, 'id' | 'name'>[];
  stages: Pick<Stage, 'id' | 'name'>[];
  mediaAssets: Pick<MediaAsset, 'id' | 'name' | 'type'>[];
}

// Build a human-readable label for a cue. Cues have no stored name — the
// kind + payload IS the identity, so this derivation is what the user sees
// throughout the macro editor, slide menu, and bindings list.
export function describeCue(cue: Cue | undefined, context: DescribeCueContext): string {
  if (!cue) return 'Unknown cue';
  const kindLabel = CUE_KIND_LABELS[cue.kind];
  const target = describeTarget(cue, context);
  return target ? `${kindLabel} → ${target}` : kindLabel;
}

function describeTarget(cue: Cue, context: DescribeCueContext): string | null {
  switch (cue.kind) {
    case 'overlay.activate':
    case 'overlay.clear': {
      const id = (cue.payload as { overlayId?: Id }).overlayId;
      return findName(context.overlays, id);
    }
    case 'mediaLayer.set':
    case 'video.arm':
    case 'audio.arm': {
      const id = (cue.payload as { assetId?: Id }).assetId;
      return findName(context.mediaAssets, id);
    }
    case 'stage.set': {
      const id = (cue.payload as { stageId?: Id }).stageId;
      return findName(context.stages, id);
    }
    case 'layer.clear': {
      const layer = (cue.payload as { layer?: CueClearLayer }).layer;
      return layer ?? null;
    }
    case 'flow.wait': {
      const ms = (cue.payload as { ms?: number }).ms;
      return typeof ms === 'number' ? `${ms} ms` : null;
    }
    default:
      return null;
  }
}

function findName(list: Array<{ id: Id; name: string }>, id: Id | undefined): string | null {
  if (!id) return null;
  return list.find((item) => item.id === id)?.name ?? null;
}
