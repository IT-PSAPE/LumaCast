import { useId, useRef, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '@lumacast/ui';

export interface BrowserSourceDialogProps {
  url: string;
  setUrl: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onClose: () => void;
}

export function BrowserSourceDialog({ url, setUrl, onSubmit, onClose }: BrowserSourceDialogProps) {
  const formId = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open
      title="Browser Source"
      className="stream-modal"
      onClose={onClose}
      initialFocus={urlRef}
      footer={<>
        <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
        <button className="primary-button" type="submit" form={formId}>Add Source</button>
      </>}
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="stream-form-fields"><label>URL<input ref={urlRef} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} required /></label></div>
      </form>
    </Modal>
  );
}
