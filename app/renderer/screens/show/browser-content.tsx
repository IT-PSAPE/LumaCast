import { Logo } from '@renderer/components/assets';
import { SlideBrowserContent } from '../../features/items/slide-browser-content';
import type { SlideBrowserContentVariant } from '../../features/items/use-deck-browser-view';

interface ShowBrowserContentProps {
  variant: SlideBrowserContentVariant;
}

export function ShowBrowserContent({ variant }: ShowBrowserContentProps) {
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
  }
}
