// Pure decisions for presentation-layer bookkeeping: which layer an armed
// media asset belongs on, and what a "clear this layer" / "clear everything"
// request implies. The provider executes the resulting state writes and
// side effects (setState, recordObsEvent, clearOutputDeckItem); this module
// only decides what those effects should be.

export type PresentationLayerKey = 'media' | 'video' | 'content' | 'overlay';

export type MediaLayerTarget = 'media' | 'video';

// Any non-video asset lands on the still/media layer; video assets get the
// dedicated video layer so they can loop/transport independently.
export function resolveMediaLayerTarget(assetType: string): MediaLayerTarget {
  return assetType === 'video' ? 'video' : 'media';
}

export interface LayerClearPlan {
  clearsMediaLayer: boolean;
  clearsVideoLayer: boolean;
  hidesContentLayer: boolean;
  clearsOutputDeckItem: boolean;
  clearsOverlays: boolean;
  statusText: string;
}

export function resolveLayerClearPlan(layer: PresentationLayerKey): LayerClearPlan {
  switch (layer) {
    case 'media':
      return {
        clearsMediaLayer: true,
        clearsVideoLayer: false,
        hidesContentLayer: false,
        clearsOutputDeckItem: false,
        clearsOverlays: false,
        statusText: 'Media layer cleared',
      };
    case 'video':
      return {
        clearsMediaLayer: false,
        clearsVideoLayer: true,
        hidesContentLayer: false,
        clearsOutputDeckItem: false,
        clearsOverlays: false,
        statusText: 'Video layer cleared',
      };
    case 'content':
      return {
        clearsMediaLayer: false,
        clearsVideoLayer: false,
        hidesContentLayer: true,
        clearsOutputDeckItem: true,
        clearsOverlays: false,
        statusText: 'Content layer cleared',
      };
    case 'overlay':
    default:
      return {
        clearsMediaLayer: false,
        clearsVideoLayer: false,
        hidesContentLayer: false,
        clearsOutputDeckItem: false,
        clearsOverlays: true,
        statusText: 'Overlay layer cleared',
      };
  }
}
