import { useState } from "react";
import { FolderOpen, ChevronUp, FileImage } from "lucide-react";
import { Btn } from "./ui";
type Listing = {
  path: string;
  parent: string;
  folders: { name: string; path: string }[];
  files: { name: string; path: string }[];
};
export function FolderBrowser({
  onImport,
  onError,
}: {
  onImport: (paths: string[]) => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null),
    [loading, setLoading] = useState(false);
  async function browse(path?: string) {
    setLoading(true);
    try {
      const root = path ?? (await window.lumaflux.chooseDirectory());
      if (root)
        setListing(
          await window.lumaflux.command("browse_folder", { path: root }),
        );
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="folder-explorer">
      <Btn disabled={loading} onClick={() => void browse()}>
        <FolderOpen size={14} />
        Explore folders
      </Btn>
      {listing && (
        <>
          <div className="folder-path" title={listing.path}>
            <Btn
              aria-label="Parent folder"
              disabled={listing.parent === listing.path || loading}
              onClick={() => void browse(listing.parent)}
            >
              <ChevronUp size={14} />
            </Btn>
            <span>{listing.path}</span>
          </div>
          <div className="directory-entries">
            {listing.folders.map((f) => (
              <button
                className="nav-item"
                key={f.path}
                disabled={loading}
                onClick={() => void browse(f.path)}
              >
                <FolderOpen size={13} />
                {f.name}
              </button>
            ))}
            {listing.files.map((f) => (
              <button
                className="nav-item"
                key={f.path}
                title={`Import ${f.name}`}
                onClick={() =>
                  void onImport([f.path]).catch((e) => onError(String(e)))
                }
              >
                <FileImage size={13} />
                {f.name}
              </button>
            ))}
            {!listing.files.length && !listing.folders.length && (
              <p className="muted">No supported photos or folders.</p>
            )}
          </div>
          <Btn
            className="wide"
            disabled={loading}
            onClick={() =>
              void onImport([listing.path]).catch((e) => onError(String(e)))
            }
          >
            Import this folder
          </Btn>
        </>
      )}
    </div>
  );
}
