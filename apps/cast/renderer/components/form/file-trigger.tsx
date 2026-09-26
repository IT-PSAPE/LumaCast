import { useCallback, type ChangeEvent, type HTMLAttributes, type MutableRefObject, type ReactNode, type Ref } from 'react';
import { cn } from '@lumacast/ui';

export interface FileTriggerHandle {
  open: () => void;
  reset: () => void;
}

interface FileTriggerRootProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'onChange' | 'onSelect'> {
  accept?: string;
  children?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  multiple?: boolean;
  onSelect: (files: FileList, event: ChangeEvent<HTMLInputElement>) => void;
}

function assignInputRef(ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  (ref as MutableRefObject<HTMLInputElement | null>).current = node;
}

function Root({ accept, children, className, disabled = false, hidden = false, inputRef, multiple = false, onSelect, ...spanProps }: FileTriggerRootProps) {
  const inputClassName = hidden ? 'hidden' : 'absolute inset-0 cursor-pointer opacity-0';
  const rootClassName = hidden ? 'contents' : 'relative inline-flex';

  const handleInputRef = useCallback((node: HTMLInputElement | null) => {
    assignInputRef(inputRef, node);
  }, [inputRef]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return;
    onSelect(event.target.files, event);
    event.target.value = '';
  }

  return (
    <span {...spanProps} className={cn(rootClassName, className)}>
      {children}
      <input ref={handleInputRef} type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={handleChange} className={inputClassName} />
    </span>
  );
}

export const FileTrigger = { Root };
