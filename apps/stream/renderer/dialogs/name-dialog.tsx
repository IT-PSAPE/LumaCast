import { useId, useRef, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '@lumacast/ui';

export type NameDialogMode = 'new' | 'duplicate' | 'rename' | 'delete';

const MODE_VERB: Record<NameDialogMode, string> = { new: 'New', duplicate: 'Duplicate', rename: 'Rename', delete: 'Delete' };

export interface NameDialogProps {
  /** What is being named, e.g. "Scene". Drives the title and the delete button label. */
  noun: string;
  mode: NameDialogMode;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  nameMaxLength: number;
  /** Confirmation text shown in delete mode. */
  deleteCopy: string;
  error?: string;
  working?: boolean;
  deleteDisabled?: boolean;
  /** Commits the name in non-delete modes, or the deletion in delete mode. */
  onSubmit: () => void;
  onClose: () => void;
}

export function NameDialog({ noun, mode, name, setName, nameMaxLength, deleteCopy, error = '', working = false, deleteDisabled = false, onSubmit, onClose }: NameDialogProps) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const deleting = mode === 'delete';
  return (
    <Modal
      open
      title={`${MODE_VERB[mode]} ${noun}`}
      className="scene-modal"
      onClose={onClose}
      closeDisabled={working}
      initialFocus={deleting ? undefined : nameRef}
      footer={<>
        <button className="secondary-button" type="button" disabled={working} onClick={onClose}>Cancel</button>
        {deleting
          ? <button className="primary-button danger-button" type="button" disabled={working || deleteDisabled} onClick={onSubmit}>{working ? 'Deleting…' : `Delete ${noun}`}</button>
          : <button className="primary-button" type="submit" form={formId} disabled={working}>{working ? 'Saving…' : 'Save'}</button>}
      </>}
    >
      {deleting
        ? <div className="scene-delete-copy">{deleteCopy}</div>
        : <form id={formId} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields"><label>Name<input ref={nameRef} maxLength={nameMaxLength} value={name} onChange={(event) => setName(event.target.value)} required /></label></div>
        </form>}
      {error && <p className="collection-error" role="alert">{error}</p>}
    </Modal>
  );
}
