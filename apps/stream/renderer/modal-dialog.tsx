import { useEffect, useRef, type ReactNode } from 'react';

interface ModalDialogProps {
  backdropClassName: string;
  children: ReactNode;
  className: string;
  labelledBy: string;
  onClose: () => void;
  openerRef: { current: HTMLElement | null };
}

/** Closes a hand-rolled dialog on Escape while it is mounted; `working` suspends it during async submits. */
export function useEscapeKey(onClose: () => void, working = false): void {
  const closeHandlerRef = useRef(onClose);
  closeHandlerRef.current = onClose;
  useEffect(() => {
    if (working) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeHandlerRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [working]);
}

export function ModalDialog({ backdropClassName, children, className, labelledBy, onClose, openerRef }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeHandlerRef = useRef(onClose);
  closeHandlerRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], area[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )).filter((element) => {
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const closedDetails = element.closest('details:not([open])');
      return !closedDetails || (element.tagName === 'SUMMARY' && element.parentElement === closedDetails);
    }).sort((left, right) => {
      const position = left.compareDocumentPosition(right);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    (focusableElements()[0] ?? dialog).focus();
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [openerRef]);

  return <div className={backdropClassName} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeHandlerRef.current(); }}>
    <div ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
      {children}
    </div>
  </div>;
}
