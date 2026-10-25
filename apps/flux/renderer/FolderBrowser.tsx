import { useState } from "react";
import { FolderOpen, ChevronUp, FileImage } from "lucide-react";
import { ListRow, ReacstButton } from "@lumacast/ui";
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
      <ReacstButton size="sm" disabled={loading} onClick={() => void browse()}>
        <FolderOpen size={13} />
        Explore folders
      </ReacstButton>
      {listing && (
        <>
          <div className="folder-path" title={listing.path}>
            <ReacstButton.Icon
              size="sm"
              aria-label="Parent folder"
              disabled={listing.parent === listing.path || loading}
              onClick={() => void browse(listing.parent)}
            >
              <ChevronUp size={14} />
            </ReacstButton.Icon>
            <span>{listing.path}</span>
          </div>
          <div className="directory-entries">
            {listing.folders.map((f) => (
              <ListRow
                as="button"
                density="compact"
                key={f.path}
                disabled={loading}
                onClick={() => void browse(f.path)}
              >
                <ListRow.Leading>
                  <FolderOpen size={13} />
                </ListRow.Leading>
                <ListRow.Label>{f.name}</ListRow.Label>
              </ListRow>
            ))}
            {listing.files.map((f) => (
              <ListRow
                as="button"
                density="compact"
                key={f.path}
                onClick={() =>
                  void onImport([f.path]).catch((e) => onError(String(e)))
                }
              >
                <ListRow.Leading>
                  <FileImage size={13} />
                </ListRow.Leading>
                <ListRow.Label>
                  <span title={`Import ${f.name}`}>{f.name}</span>
                </ListRow.Label>
              </ListRow>
            ))}
            {!listing.files.length && !listing.folders.length && (
              <p className="muted">No supported photos or folders.</p>
            )}
          </div>
          <ReacstButton
            size="sm"
            fullWidth
            disabled={loading}
            onClick={() =>
              void onImport([listing.path]).catch((e) => onError(String(e)))
            }
          >
            Import this folder
          </ReacstButton>
        </>
      )}
    </div>
  );
}
