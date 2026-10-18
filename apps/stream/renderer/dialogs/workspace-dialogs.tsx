import type { Dispatch, SetStateAction } from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '../modal-dialog';

type WorkspaceDialogKind = 'new' | 'duplicate' | 'rename' | 'delete';

export interface SceneDialogProps {
  mode: 'rename' | 'delete';
  sceneName: string;
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function SceneDialog({ mode, sceneName, nameDraft, setNameDraft, onRename, onDelete, onClose }: SceneDialogProps) {
  useEscapeKey(onClose);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="scene-dialog-title">
        <div className="modal-heading"><div><h2 id="scene-dialog-title">{mode === 'rename' ? 'Rename Scene' : 'Delete Scene'}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
        {mode === 'rename' ? <form onSubmit={(event) => { event.preventDefault(); onRename(); }}>
          <div className="stream-form-fields"><label>Name<input autoFocus maxLength={120} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} required /></label></div>
          <div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save</button></div>
        </form> : <>
          <div className="scene-delete-copy">Delete “{sceneName}” and remove its sources from this scene collection?</div>
          <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button danger-button" onClick={onDelete}>Delete Scene</button></div>
        </>}
      </section>
    </div>
  );
}

export interface CollectionDialogProps {
  mode: WorkspaceDialogKind;
  activeName: string | undefined;
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  error: string;
  working: boolean;
  itemCount: number;
  onSubmit: () => void;
  onClose: () => void;
}

export function CollectionDialog({ mode, activeName, nameDraft, setNameDraft, error, working, itemCount, onSubmit, onClose }: CollectionDialogProps) {
  useEscapeKey(onClose, working);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <div className="modal-heading"><div><h2 id="collection-dialog-title">{mode === 'new' ? 'New Collection' : mode === 'duplicate' ? 'Duplicate Collection' : mode === 'rename' ? 'Rename Collection' : 'Delete Collection'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={onClose}><X size={17} /></button></div>
        {mode === 'delete' ? <>
          <div className="scene-delete-copy">Delete “{activeName}”? Its scene collection will be removed. Imported media remains available to other collections.</div>
          {error && <p className="collection-error" role="alert">{error}</p>}
          <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button danger-button" disabled={working || itemCount <= 1} onClick={onSubmit}>{working ? 'Deleting…' : 'Delete Collection'}</button></div>
        </> : <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields"><label>Name<input autoFocus maxLength={80} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} required /></label></div>
          {error && <p className="collection-error" role="alert">{error}</p>}
          <div className="modal-footer"><button className="secondary-button" type="button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
        </form>}
      </section>
    </div>
  );
}

export interface ProfileDialogProps {
  mode: WorkspaceDialogKind;
  activeName: string | undefined;
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  error: string;
  working: boolean;
  itemCount: number;
  onSubmit: () => void;
  onClose: () => void;
}

export function ProfileDialog({ mode, activeName, nameDraft, setNameDraft, error, working, itemCount, onSubmit, onClose }: ProfileDialogProps) {
  useEscapeKey(onClose, working);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div className="modal-heading"><div><h2 id="profile-dialog-title">{mode === 'new' ? 'New Profile' : mode === 'duplicate' ? 'Duplicate Profile' : mode === 'rename' ? 'Rename Profile' : 'Delete Profile'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={onClose}><X size={17} /></button></div>
        {mode === 'delete' ? <>
          <div className="scene-delete-copy">Delete “{activeName}”? Output settings and hotkeys saved in this profile will be removed.</div>
          {error && <p className="collection-error" role="alert">{error}</p>}
          <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button danger-button" disabled={working || itemCount <= 1} onClick={onSubmit}>{working ? 'Deleting…' : 'Delete Profile'}</button></div>
        </> : <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields"><label>Name<input autoFocus maxLength={80} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} required /></label></div>
          {error && <p className="collection-error" role="alert">{error}</p>}
          <div className="modal-footer"><button className="secondary-button" type="button" disabled={working} onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
        </form>}
      </section>
    </div>
  );
}

export interface BrowserSourceDialogProps {
  url: string;
  setUrl: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  onClose: () => void;
}

export function BrowserSourceDialog({ url, setUrl, onSubmit, onClose }: BrowserSourceDialogProps) {
  useEscapeKey(onClose);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="capture-modal stream-modal" role="dialog" aria-modal="true" aria-labelledby="browser-title">
        <div className="modal-heading"><div><h2 id="browser-title">Browser Source</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <div className="stream-form-fields"><label>URL<input autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} required /></label></div>
          <div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Add Source</button></div>
        </form>
      </section>
    </div>
  );
}
