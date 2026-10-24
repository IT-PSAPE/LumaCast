import { type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { cn } from './cn';
import { useOverlayStackEntry } from './overlay';

// The close glyph is inlined rather than pulled from an icon package: @lumacast/ui
// may depend only on `@lumacast/kernel`, so the markup is written here. The paths
// and stroke geometry match lucide's `X` at 24x24 / stroke-width 2, so the icon
// renders identically at the 18px size the app stylesheet expects.
function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

// `md` adds nothing: it is the `.modal` base chrome (860 x 620 max), so existing
// call sites do not move. The others are Tailwind utilities, which are emitted
// after `@layer components` and therefore override the base width/height.
const SIZE_CLASS: Record<ModalSize, string | undefined> = {
  sm: 'w-[min(440px,95vw)] max-h-[min(520px,88vh)]',
  md: undefined,
  lg: 'w-[min(1100px,95vw)] max-h-[min(780px,92vh)]',
  full: 'w-[95vw] h-[92vh] max-h-[92vh]',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Prevents user initiated close actions while the dialog is working. */
  closeDisabled?: boolean;
  /** Dialog width/height preset. Defaults to `md`, the base `.modal` metrics. */
  size?: ModalSize;
  /** Merged after the built-in classes; the caller wins on conflicts. */
  className?: string;
  /** Shown under the title and exposed as the dialog's accessible description. */
  description?: string;
  /** Bottom action row, separated by a top border, actions trailing. */
  footer?: ReactNode;
  /** When false, hides the close button and ignores Escape and backdrop dismissal. Defaults to true. */
  dismissible?: boolean;
  /** Element that receives focus on open. Defaults to Base UI's first-tabbable behaviour. */
  initialFocus?: RefObject<HTMLElement | null>;
}

// Modal is the app's dialog surface. The class names are part of the stylesheet
// contract (`.modal`, `.modal-backdrop`, `.modal-heading`); chrome lives in
// theme.css and this component only layers size and structure on top.
export function Modal({
  open,
  onClose,
  title,
  children,
  closeDisabled = false,
  size = 'md',
  className,
  description,
  footer,
  dismissible = true,
  initialFocus,
}: ModalProps) {
  // Join the overlay stack so a modal opened from another modal is layered
  // above it, and so only the topmost one reacts to Escape. z-index is owned by
  // overlay.tsx (backdrop = slot, popup = slot + 1); the stylesheet sets none.
  const { zIndex, backdropZIndex, isTopmost } = useOverlayStackEntry(open, 'modal');

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v, details) => {
        if (v) return;
        if (closeDisabled) return;
        if (!dismissible && (details.reason === 'escape-key' || details.reason === 'outside-press')) return;
        if (details.reason === 'escape-key' && !isTopmost) return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" style={{ zIndex: backdropZIndex }} />
        <Dialog.Popup
          className={cn('modal', SIZE_CLASS[size], className)}
          style={{ zIndex }}
          initialFocus={initialFocus}
        >
          <div className="modal-heading">
            {description ? (
              <div className="min-w-0">
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description className="m-0 mt-0.5 text-xs text-[var(--text-color-secondary)]">
                  {description}
                </Dialog.Description>
              </div>
            ) : (
              <Dialog.Title>{title}</Dialog.Title>
            )}
            {dismissible ? (
              <Dialog.Close className="btn icon" aria-label="Close dialog" disabled={closeDisabled}>
                <CloseIcon size={18} />
              </Dialog.Close>
            ) : null}
          </div>
          {children}
          {footer ? (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-t-[var(--border-color-primary)] px-4 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
