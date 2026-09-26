import { useEffect, useState } from "react";
import { FolderOpen, Plus, Trash2, Copy, Check } from "lucide-react";
import type { AgentSettings, ExportOptions } from "@lumacast/photo-model";
import type { DesktopAPI } from "../shared/desktop-api";
import { Btn, Modal } from "./ui";
export function ExportDialog({
  open,
  onClose,
  count,
  onExport,
  api,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  onExport: (options: Omit<ExportOptions, "ids">) => Promise<void>;
  api: DesktopAPI;
}) {
  const [directory, setDirectory] = useState("");
  const [format, setFormat] = useState<"jpeg" | "png" | "webp">("jpeg");
  const [quality, setQuality] = useState(90);
  const [resize, setResize] = useState(false);
  const [size, setSize] = useState(2400);
  const [suffix, setSuffix] = useState("-edited");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Export ${count} photo${count === 1 ? "" : "s"}`}
    >
      <p className="muted">
        Create edited copies. Your originals stay untouched.
      </p>
      <div className="form">
        <label>
          Destination
          <div className="inline">
            <input
              aria-label="Export destination"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="Choose a folder"
            />
            <Btn
              aria-label="Choose export folder"
              onClick={async () => {
                const p = await api.chooseDirectory();
                if (p) setDirectory(p);
              }}
            >
              <FolderOpen size={16} />
            </Btn>
          </div>
        </label>
        <div className="form-columns">
          <label>
            Format
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label>
            Quality
            <input
              aria-label="Export quality"
              type="number"
              min={1}
              max={100}
              disabled={format === "png"}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Filename suffix
          <input
            aria-label="Filename suffix"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={resize}
            onChange={(e) => setResize(e.target.checked)}
          />
          Resize to maximum dimension
        </label>
        {resize && (
          <label>
            Longest edge (pixels)
            <input
              type="number"
              min={16}
              max={20000}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
        )}
        <p className="muted small">
          sRGB output · Location metadata removed · Existing filenames get a
          unique suffix
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn
          className="primary"
          disabled={!directory || !count || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onExport({
                directory,
                format,
                quality,
                maxDimension: resize ? size : undefined,
                suffix,
              });
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Starting…" : "Export photos"}
        </Btn>
      </div>
    </Modal>
  );
}
export function AgentDialog({
  open,
  onClose,
  api,
}: {
  open: boolean;
  onClose: () => void;
  api: DesktopAPI;
}) {
  const [settings, setSettings] = useState<AgentSettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setError("");
      api
        .settings()
        .then(setSettings)
        .catch((e) => setError(e.message));
    }
  }, [open]);
  const save = async (roots: string[]) => {
    setBusy(true);
    setError("");
    try {
      setSettings(await api.updateSettings(true, roots));
    } catch (e) {
      setError((e as Error).message);
      setSettings(await api.settings());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Local agent access">
      <p className="muted">
        Connect MCP-compatible agents to your library. Edits appear here, with
        the same undo history as manual changes.
      </p>
      {settings && (
        <>
          <div className="agent-switch">
            <div>
              <strong>Agent access is always on</strong>
              <p className="muted small">
                Starts automatically with Lumaflux. Only authenticated clients
                on this computer.
              </p>
            </div>
          </div>
          <h3>Allowed folders</h3>
          <p className="muted small">
            Agents can import from and export to these folders. With no allowed
            folders, agents can still work with the imported library.
          </p>
          <div className="root-list">
            {settings.roots.map((root) => (
              <div key={root}>
                <span>{root}</span>
                <Btn
                  aria-label={`Remove ${root}`}
                  disabled={busy}
                  onClick={() => save(settings.roots.filter((r) => r !== root))}
                >
                  <Trash2 size={14} />
                </Btn>
              </div>
            ))}
          </div>
          <Btn
            disabled={busy}
            onClick={async () => {
              const p = await api.chooseDirectory();
              if (p && !settings.roots.includes(p))
                await save([...settings.roots, p]);
            }}
          >
            <Plus size={14} />
            Add folder
          </Btn>
          <h3>Client configuration</h3>
          <p className="muted small">
            Requires Node.js. Keep Lumaflux running. Add this to your agent’s
            MCP configuration.
          </p>
          <pre className="config">{settings.clientConfig}</pre>
          <Btn
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(settings.clientConfig);
                setCopied(true);
              } catch {
                setError(
                  "Could not copy. Select the configuration text and copy it.",
                );
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}Copy
            configuration
          </Btn>
          {settings.endpoint && (
            <p className="muted small">
              Connected endpoint: {settings.endpoint}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
