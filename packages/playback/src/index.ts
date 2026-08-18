export {
  activateOverlayPlayback,
  advanceOverlayPlayback,
  clearAllOverlayPlayback,
  clearOverlayPlayback,
  collapseOverlayPlaybackToSingle,
  getNextOverlayPlaybackDelay,
  getOverlayRenderLayers,
  normalizeOverlayAnimation,
  type ActiveOverlayEntry,
  type OverlayPlaybackMode,
  type OverlayPlaybackState,
  type OverlayRenderLayer,
} from './overlay-playback';

export {
  resolveAdjacentAssetAllowingUnset,
  resolveAdjacentAssetRequiringCurrent,
} from './playlist-navigation';

export {
  resolveLayerClearPlan,
  resolveMediaLayerTarget,
  type LayerClearPlan,
  type MediaLayerTarget,
  type PresentationLayerKey,
} from './layer-transitions';

export { resolveStageArmedAt } from './stage-arming';
