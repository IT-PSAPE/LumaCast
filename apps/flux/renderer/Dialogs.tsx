import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2, Copy, Check } from "lucide-react";
import type { AgentSettings, ExportOptions } from "@lumacast/photo-model";
import type { DesktopAPI } from "../shared/desktop-api";
import {
  Checkbox,
  Modal,
  NumberField,
  ReacstButton,
  Select,
  TextField,
} from "@lumacast/ui";

function useDialogTask() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    setError,
    run,
    close: (onClose: () => void) => {
      if (!pending.current) onClose();
    },
  };
}

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
  const { busy, error, setError, run, close } = useDialogTask();
  useEffect(() => {
    if (open) setError("");
  }, [open, setError]);
  return (
    <Modal
      open={open}
      onClose={() => close(onClose)}
      closeDisabled={busy}
      title={`Export ${count} photo${count === 1 ? "" : "s"}`}
      className="w-[min(520px,95vw)]"
      footer={
        <>
          <ReacstButton size="sm" disabled={busy} onClick={() => close(onClose)}>
            Cancel
          </ReacstButton>
          <ReacstButton
            size="sm"
            variant="primary"
            disabled={!directory || !count || busy}
            onClick={() => void run(async () => {
              await onExport({
                directory,
                format,
                quality,
                maxDimension: resize ? size : undefined,
                suffix,
              });
              onClose();
            })}
          >
            {busy ? "Starting…" : "Export photos"}
          </ReacstButton>
        </>
      }
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-auto p-4">
        <p className="muted">
          Create edited copies. Your originals stay untouched.
        </p>
        <div className="flex items-end gap-2">
          <TextField
            className="flex-1"
            label="Export destination"
            placeholder="Choose a folder"
            value={directory}
            disabled={busy}
            onValueChange={setDirectory}
          />
          <ReacstButton.Icon
            aria-label="Choose export folder"
            disabled={busy}
            onClick={() => void run(async () => {
              const p = await api.chooseDirectory();
              if (p) setDirectory(p);
            })}
          >
            <FolderOpen size={16} />
          </ReacstButton.Icon>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Format"
            disabled={busy}
            value={format}
            onValueChange={setFormat}
            options={[
              { value: "jpeg", label: "JPEG" },
              { value: "png", label: "PNG" },
              { value: "webp", label: "WebP" },
            ]}
          />
          <NumberField
            label="Quality"
            min={1}
            max={100}
            disabled={busy || format === "png"}
            value={quality}
            onValueChange={setQuality}
          />
        </div>
        <TextField
          label="Filename suffix"
          disabled={busy}
          value={suffix}
          onValueChange={setSuffix}
        />
        <Checkbox
          label="Resize to maximum dimension"
          disabled={busy}
          checked={resize}
          onCheckedChange={setResize}
        />
        {resize && (
          <NumberField
            label="Longest edge (pixels)"
            disabled={busy}
            min={16}
            max={20000}
            value={size}
            onValueChange={setSize}
          />
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
  const { busy, error, setError, run, close } = useDialogTask();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (open) {
      setSettings(undefined);
      setError("");
      setCopied(false);
      api
        .settings()
        .then((next) => { if (!cancelled) setSettings(next); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    }
    return () => { cancelled = true; };
  }, [open, api, setError]);
  const save = async (roots: string[]) => {
    try {
      setSettings(await api.updateSettings(true, roots));
    } catch (e) {
      // Recover the actual grants if an update partially succeeded, preserving
      // the primary error even when refreshing settings also fails.
      try { setSettings(await api.settings()); } catch { /* Keep the previous grants. */ }
      throw e;
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => close(onClose)}
      closeDisabled={busy}
      title="Local agent access"
      className="w-[min(520px,95vw)]"
    >
      <div className="min-h-0 overflow-auto p-4">
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
                <ReacstButton.Icon
                  size="sm"
                  aria-label={`Remove ${root}`}
                  disabled={busy}
                  onClick={() => void run(() => save(settings.roots.filter((r) => r !== root)))}
                >
                  <Trash2 size={14} />
                </ReacstButton.Icon>
              </div>
            ))}
          </div>
          <ReacstButton
            size="sm"
            disabled={busy}
            onClick={() => void run(async () => {
              const p = await api.chooseDirectory();
              if (p && !settings.roots.includes(p))
                await save([...settings.roots, p]);
            })}
          >
            <Plus size={13} />
            Add folder
          </ReacstButton>
          <h3>Client configuration</h3>
          <p className="muted small">
            Requires Node.js. Keep Lumaflux running. Add this to your agent’s
            MCP configuration.
          </p>
          <pre className="config">{settings.clientConfig}</pre>
          <ReacstButton
            size="sm"
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
            {copied ? <Check size={13} /> : <Copy size={13} />}Copy
            configuration
          </ReacstButton>
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
      </div>
    </Modal>
  );
}
