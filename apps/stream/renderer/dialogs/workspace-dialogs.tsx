import { useId, type Dispatch, type SetStateAction } from 'react';
import { Modal, TextField } from '@lumacast/ui';

export interface BrowserSourceDialogProps {
  url: string;
  setUrl: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onClose: () => void;
}

export function BrowserSourceDialog({ url, setUrl, onSubmit, onClose }: BrowserSourceDialogProps) {
  const formId = useId();
  const urlId = useId();
  // TextField does not forward refs; resolve the input by id when Modal asks for initial focus.
  const urlRef = { get current() { return document.getElementById(urlId); } };
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
        <div className="stream-form-fields"><TextField id={urlId} label="URL" type="url" placeholder="https://example.com" value={url} onValueChange={setUrl} /></div>
      </form>
    </Modal>
  );
}
