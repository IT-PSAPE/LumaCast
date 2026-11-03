import { useCallback, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { ReacstButton, Toolbar } from '@lumacast/ui';
import type { StreamSource } from '../shared/desktop-api';
import {
  currentSourceSlideIndex, getSlidePlaybackRevision, isSlideSource, isSourceSlideAutoAdvancing,
  sourceSlideImages, subscribeSlidePlayback, type SlideNavigationAction,
} from './slideshow';

export interface SlideControlsProps {
  source: StreamSource | null;
  onNavigate: (action: SlideNavigationAction) => void;
  disabled?: boolean;
}

function useSlidePlaybackRevision(source: StreamSource | null): number {
  const subscribe = useCallback((listener: () => void) => source
    ? subscribeSlidePlayback(source, listener)
    : () => undefined, [source]);
  const getSnapshot = useCallback(() => source ? getSlidePlaybackRevision(source) : 0, [source]);
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

export function SlideControls({ source, onNavigate, disabled = false }: SlideControlsProps) {
  const revision = useSlidePlaybackRevision(source);
  void revision;
  if (!source || !isSlideSource(source)) return null;
  const count = sourceSlideImages(source).length;
  const index = currentSourceSlideIndex(source);
  const automatic = isSourceSlideAutoAdvancing(source);
  return <Toolbar.Group label="Slides" title={source.name}>
    <ReacstButton.Icon variant="ghost" size="sm" label="Previous slide" disabled={disabled || index <= 0} onClick={() => onNavigate('previous')}><ChevronLeft /></ReacstButton.Icon>
    <ReacstButton.Icon variant="ghost" size="sm" label="Next slide" disabled={disabled || index < 0 || index >= count - 1} onClick={() => onNavigate('next')}><ChevronRight /></ReacstButton.Icon>
    <ReacstButton.Icon variant="ghost" size="sm" label="Reset slides" disabled={disabled || index < 0 || (index === 0 && !automatic)} onClick={() => onNavigate('reset')}><RotateCcw /></ReacstButton.Icon>
    <span className="min-w-10 text-center text-xs tabular-nums text-secondary" role="status" aria-live={automatic ? 'off' : 'polite'} aria-atomic="true" aria-label={`Slide ${index < 0 ? 0 : index + 1} of ${count}`}>{index < 0 ? 0 : index + 1} / {count}</span>
  </Toolbar.Group>;
}
