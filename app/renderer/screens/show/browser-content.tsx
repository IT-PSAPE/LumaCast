import { Logo } from '@renderer/components/assets';
import { ContinuousSlideBrowser } from '../../features/items/continuous-slide-browser';
import { SlideBrowserContent } from '../../features/items/slide-browser-content';
import type { SlideBrowserContentVariant } from '../../features/items/use-deck-browser-view';
import type { PlaylistDeckSequenceItem } from '../../features/items/use-playlist-deck-sequence';

interface ShowBrowserContentProps {
  variant: SlideBrowserContentVariant;
  items: PlaylistDeckSequenceItem[];
}

// Exactly one browser-content variant mounts: the empty placeholder, the
// single-slide tree, or the continuous playlist tree. Each child's prop type
// accepts only the variants it can render, so an invalid variant is a
// compile error instead of a silent no-op mount.
export function ShowBrowserContent({ variant, items }: ShowBrowserContentProps) {
  switch (variant) {
    case 'empty':
      return (
        <div className="flex h-full min-h-0 items-center justify-center p-2">
          <Logo className="size-60 opacity-10" />
        </div>
      );
    case 'single-grid':
    case 'single-list':
      return <SlideBrowserContent variant={variant} />;
    case 'continuous-grid':
    case 'continuous-list':
      return <ContinuousSlideBrowser variant={variant} items={items} />;
  }
}