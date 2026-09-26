import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';

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

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Modal is the app's dialog surface. The class names are part of the Flux
// stylesheet contract (`.modal`, `.modal-backdrop`, `.modal-heading`) and are
// intentionally not restyled here.
export function Modal({ open, onClose, title, children }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="modal">
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="btn icon" aria-label="Close dialog">
              <CloseIcon size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
