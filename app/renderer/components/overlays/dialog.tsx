import { X } from 'lucide-react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react';
import { ReacstButton } from '@renderer/components/controls/button';
import { cn } from '@renderer/utils/cn';
import { useOverlayContainer, useOverlayStackEntry } from './overlay-primitives';

interface DialogContextValue {
  state: { isOpen: boolean; isTopmost: boolean; zIndex: number };
  actions: { close: () => void; open: () => void; setOpen: (nextOpen: boolean) => void };
  meta: {
    closeOnBackdropClick: boolean;
    descriptionId?: string;
    setDescriptionId: (id?: string) => void;
    setTitleId: (id?: string) => void;
    titleId?: string;
  };
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within a Dialog.Root');
  return context;
}

interface DialogRootProps {
  children: ReactNode;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  open?: boolean;
}

function Root({ children, closeOnBackdropClick = true, closeOnEscape = true, defaultOpen = false, onOpenChange, open }: DialogRootProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [titleId, setTitleId] = useState<string | undefined>(undefined);
  const [descriptionId, setDescriptionId] = useState<string | undefined>(undefined);
  const isOpen = isControlled ? open : uncontrolledOpen;
  const { isTopmost, zIndex } = useOverlayStackEntry(isOpen);

  const setOpenState = useCallback((nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  const openDialog = useCallback(() => {
    setOpenState(true);
  }, [setOpenState]);

  const closeDialog = useCallback(() => {
    setOpenState(false);
  }, [setOpenState]);

  // Base UI dismisses on Escape and outside press itself. Two app rules ride on
  // top: `closeOnEscape` opts out entirely, and Escape only reaches the topmost
  // entry of the workbench overlay stack — sibling dialogs (a picker and the
  // upload dialog it spawns) are separate Base UI roots, so only the stack knows
  // which one is on top.
  const handleBaseOpenChange = useCallback((nextOpen: boolean, details: BaseDialog.Root.ChangeEventDetails) => {
    if (!nextOpen && details.reason === 'escape-key' && (!closeOnEscape || !isTopmost)) {
      details.cancel();
      return;
    }
    setOpenState(nextOpen);
  }, [closeOnEscape, isTopmost, setOpenState]);

  const context = useMemo<DialogContextValue>(() => ({
    state: { isOpen, isTopmost, zIndex },
    actions: { close: closeDialog, open: openDialog, setOpen: setOpenState },
    meta: { closeOnBackdropClick, descriptionId, setDescriptionId, setTitleId, titleId },
  }), [closeDialog, closeOnBackdropClick, descriptionId, isOpen, isTopmost, openDialog, setOpenState, titleId, zIndex]);

  return (
    <DialogContext.Provider value={context}>
      <BaseDialog.Root open={isOpen} onOpenChange={handleBaseOpenChange} disablePointerDismissal={!closeOnBackdropClick}>
        {children}
      </BaseDialog.Root>
    </DialogContext.Provider>
  );
}

function Trigger(props: HTMLAttributes<HTMLSpanElement>) {
  // Historically a span; `nativeButton={false}` is what tells Base UI to add the
  // button role and Enter/Space activation a real <button> would have given us.
  return <BaseDialog.Trigger nativeButton={false} render={<span />} {...props} />;
}

function Close(props: HTMLAttributes<HTMLSpanElement>) {
  return <BaseDialog.Close nativeButton={false} render={<span />} {...props} />;
}

function Portal({ children }: { children: ReactNode }) {
  const { state } = useDialog();
  const container = useOverlayContainer();
  return (
    <BaseDialog.Portal container={container} className="pointer-events-none fixed inset-0" style={{ zIndex: state.zIndex }}>
      {children}
    </BaseDialog.Portal>
  );
}

function Backdrop({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <BaseDialog.Backdrop
      {...props}
      className={cn('pointer-events-auto fixed inset-0 bg-black/60 backdrop-blur-sm', className)}
    />
  );
}

function Positioner({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <BaseDialog.Viewport {...props} className={cn('pointer-events-none fixed inset-0 flex items-center justify-center p-4', className)}>
      {children}
    </BaseDialog.Viewport>
  );
}

function Content({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <BaseDialog.Popup
      {...props}
      // Base UI makes the rest of the page inert rather than emitting
      // `aria-modal`; keep the attribute so assistive tech that predates inert
      // still treats the surface as modal.
      aria-modal="true"
      data-shortcuts-scope="ignore"
      className={cn('pointer-events-auto flex w-full max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-primary bg-primary shadow-2xl outline-none', className)}
    >
      {children}
    </BaseDialog.Popup>
  );
}

function Header({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-primary px-4 py-3', className)} {...props}>
      {children}
    </div>
  );
}

function Body({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-0 flex-1', className)} {...props}>
      {children}
    </div>
  );
}

function Title({ children, className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const generatedId = useId();
  const { setTitleId } = useDialog().meta;

  useEffect(() => {
    setTitleId(generatedId);
    return () => {
      setTitleId(undefined);
    };
  }, [generatedId, setTitleId]);

  return (
    <BaseDialog.Title {...props} id={generatedId} className={cn('m-0 text-lg font-semibold text-primary', className)}>
      {children}
    </BaseDialog.Title>
  );
}

function Description({ children, className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const generatedId = useId();
  const { setDescriptionId } = useDialog().meta;

  useEffect(() => {
    setDescriptionId(generatedId);
    return () => {
      setDescriptionId(undefined);
    };
  }, [generatedId, setDescriptionId]);

  return (
    <BaseDialog.Description {...props} id={generatedId} className={cn('text-sm text-secondary', className)}>
      {children}
    </BaseDialog.Description>
  );
}

function CloseButton({ className, label = 'Close', ...props }: Omit<ComponentProps<typeof ReacstButton.Icon>, 'children' | 'label'> & { label?: string }) {
  return (
    <BaseDialog.Close
      render={(
        <ReacstButton.Icon {...props} label={label} variant="ghost" className={cn('shrink-0', className)}>
          <X/>
        </ReacstButton.Icon>
      )}
    />
  );
}

function Footer({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between border-t border-primary px-4 py-3', className)} {...props}>
      {children}
    </div>
  );
}

export const Dialog = { Root, Trigger, Portal, Backdrop, Positioner, Content, Header, Body, Footer, Title, Description, Close, CloseButton };
