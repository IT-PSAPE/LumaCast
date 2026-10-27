import { useId, type Dispatch, type SetStateAction } from 'react';
import { Banner, Modal, ReacstButton, TextField } from '@lumacast/ui';

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
  const nameId = useId();
  // TextField does not forward refs; resolve the input by id when Modal asks for initial focus.
  const nameRef = { get current() { return document.getElementById(nameId); } };
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
        <ReacstButton size="sm" disabled={working} onClick={onClose}>Cancel</ReacstButton>
        {deleting
          ? <ReacstButton size="sm" variant="danger" disabled={working || deleteDisabled} onClick={onSubmit}>{working ? 'Deleting…' : `Delete ${noun}`}</ReacstButton>
          : <ReacstButton size="sm" variant="primary" type="submit" form={formId} disabled={working}>{working ? 'Saving…' : 'Save'}</ReacstButton>}
      </>}
    >
      {deleting
        ? <div className="scene-delete-copy">{deleteCopy}</div>
        : <form id={formId} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields"><TextField id={nameId} label="Name" maxLength={nameMaxLength} value={name} onValueChange={setName} error={error || undefined} /></div>
        </form>}
      {deleting && error && <Banner tone="error" size="sm" className="mx-4 mb-4 w-auto">{error}</Banner>}
    </Modal>
  );
}
