import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Images,
  FolderOpen,
  Heart,
  Download,
  Grid2X2,
  Image as ImageIcon,
  Search,
  Plus,
  SlidersHorizontal,
  Bot,
  Star,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Link,
  ArrowDownToLine,
} from "lucide-react";
import type { AppState, Photo, Recipe } from "@lumacast/photo-model";
import type { DesktopAPI } from "../shared/desktop-api";
import { adjustmentControls } from "@lumacast/photo-model";
import { Btn } from "./ui";
import type { HistogramData, PixelReadout } from "./histogram-data";
import { Adjustments } from "./Adjustments";
import { PanelResize } from "./PanelResize";
import { FolderBrowser } from "./FolderBrowser";
import { Viewer } from "./Viewer";
import { AgentDialog, ExportDialog } from "./Dialogs";
declare global {
  interface Window {
    lumaflux: DesktopAPI;
  }
}
const api = window.lumaflux;
const empty: AppState = { photos: [], selection: [], jobs: [], activity: [] };
export function App() {
  const [state, setState] = useState<AppState>(empty);
  const [activeId, setActiveId] = useState<string>();
  const [view, setView] = useState<"gallery" | "editor">("gallery");
  const [histogramFrame, setHistogramFrame] = useState<{
    id: string;
    data: HistogramData | null;
  } | null>(null);
  const [pixelSample, setPixelSample] = useState<PixelReadout>(null);
  const [clipping, setClipping] = useState({
    shadows: false,
    highlights: false,
  });
  const [clipHover, setClipHover] = useState<"shadows" | "highlights" | null>(
    null,
  );
  const receiveHistogram = useCallback(
    (id: string, data: HistogramData | null) => setHistogramFrame({ id, data }),
    [],
  );
  const receiveSample = useCallback(
    (value: PixelReadout) =>
      setPixelSample((previous) =>
        JSON.stringify(previous) === JSON.stringify(value) ? previous : value,
      ),
    [],
  );
  const [tab, setTab] = useState("Adjustments");
  const [aspect, setAspect] = useState("free");
  const [locked, setLocked] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() =>
    Math.max(
      180,
      Math.min(480, Number(localStorage.getItem("leftPanelWidth")) || 220),
    ),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    Math.max(
      240,
      Math.min(480, Number(localStorage.getItem("rightPanelWidth")) || 280),
    ),
  );
  useEffect(() => {
    localStorage.setItem("leftPanelWidth", String(leftWidth));
    localStorage.setItem("rightPanelWidth", String(rightWidth));
  }, [leftWidth, rightWidth]);
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [thumbSize, setThumbSize] = useState(190);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [clipboard, setClipboard] = useState<Partial<Recipe>>();
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const next = (await api.command("get_app_state")) as AppState;
    setState(next);
    setReady(true);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setNotice(e.message));
    return api.onChange(() => {
      refresh().catch((e) => setNotice(e.message));
    });
  }, [refresh]);
  const run = async (name: string, args?: unknown) => {
    const result = await api.command(name, args);
    await refresh();
    return result;
  };
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const photo = state.photos.find((p) => p.id === activeId);
  const recipe = photo ? (draft ?? photo.recipe) : undefined;
  useEffect(() => {
    setAspect("free");
  }, [
    activeId,
    photo?.recipe.rotation,
    photo?.recipe.straighten,
    photo?.recipe.flipX,
    photo?.recipe.flipY,
    JSON.stringify(photo?.recipe.lensProfile),
    photo?.recipe.lensDistortion,
    photo?.recipe.lensRed,
    photo?.recipe.lensBlue,
  ]);
  useEffect(() => {
    setDraft(null);
  }, [activeId, photo?.revision]);
  const photos = useMemo(
    () =>
      state.photos
        .filter(
          (p) =>
            (section === "all" ||
              section === "jobs" ||
              (section === "favorites" ? p.favorite : p.folder === section)) &&
            p.name.toLowerCase().includes(query.toLowerCase()) &&
            p.rating >= minRating,
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "rating"
              ? b.rating - a.rating
              : b.modifiedAt.localeCompare(a.modifiedAt),
        ),
    [state.photos, query, sort, section, minRating],
  );
  const folders = [...new Set(state.photos.map((p) => p.folder))].sort();
  const selected = new Set(state.selection);
  const activeIndex = photos.findIndex((p) => p.id === activeId);
  const select = (
    p: Photo,
    event: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
  ) => {
    let ids = [p.id];
    if (event.shiftKey && activeIndex >= 0) {
      const index = photos.findIndex((q) => q.id === p.id);
      ids = photos
        .slice(Math.min(index, activeIndex), Math.max(index, activeIndex) + 1)
        .map((q) => q.id);
    } else if (event.metaKey || event.ctrlKey) {
      ids = selected.has(p.id)
        ? state.selection.filter((id) => id !== p.id)
        : [...state.selection, p.id];
    }
    setActiveId(p.id);
    void safe(() => run("set_selection", { ids }));
  };
  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    try {
      const result = await run("import_photos", { paths });
      if (result.imported.length) {
        setActiveId(result.imported[0]);
        await run("set_selection", { ids: result.imported });
        setSection("all");
      }
      setNotice(
        `${result.imported.length} photo(s) imported.${result.errors.length ? " " + result.errors.map((e: any) => `${e.path.split("/").pop()}: ${e.message}`).join("\n") : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const commit = async (patch: Partial<Recipe>, revision = photo?.revision) => {
    if (!photo || revision === undefined) return;
    setBusy(true);
    try {
      await run("apply_edits", {
        id: photo.id,
        expectedRevision: revision,
        patch,
      });
    } catch (e) {
      setNotice((e as Error).message);
      await refresh();
    } finally {
      setDraft(null);
      setBusy(false);
    }
  };
  const action = async (name: string) => {
    if (!photo) return;
    if (name === "auto_adjust" || name === "auto_lens_correction") {
      setBusy(true);
      try {
        const result = await run(name, {
          id: photo.id,
          expectedRevision: photo.revision,
        });
        setNotice(
          [
            result.message ??
              "Auto light adjustments applied. Review the result with Compare.",
            ...(result.warnings ?? []),
          ].join(" "),
        );
      } finally {
        setDraft(null);
        setBusy(false);
      }
      return;
    }
    if (name === "relink") {
      const file = await api.chooseRelink();
      if (file) await run("relink", { id: photo.id, path: file });
      return;
    }
    const colors = Object.fromEntries(
      adjustmentControls
        .filter((c) => c[5] !== "Lens correction")
        .map(([key]) => [key, photo.recipe[key]]),
    );
    if (name === "copy") {
      setClipboard(colors);
      setNotice(
        "Adjustments copied. Crop, rotation, and lens correction stay with each photo.",
      );
      return;
    }
    if (name === "paste") {
      if (clipboard) await commit(clipboard);
      return;
    }
    if (name === "sync") {
      const ids = state.selection.filter((id) => id !== photo.id);
      if (!ids.length) {
        setNotice("Select more than one photo to apply these adjustments.");
        return;
      }
      setBusy(true);
      try {
        await run("apply_batch_edits", {
          edits: ids.map((id) => ({
            id,
            expectedRevision: state.photos.find((p) => p.id === id)!.revision,
            patch: colors,
          })),
        });
        setNotice(`Adjustments applied to ${ids.length} photo(s).`);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await run(name, { id: photo.id, expectedRevision: photo.revision });
    } finally {
      setBusy(false);
    }
  };
  const navigate = (direction: number) => {
    const next =
      photos[Math.max(0, Math.min(photos.length - 1, activeIndex + direction))];
    if (next) select(next);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('input,textarea,select,[role="slider"],[role="dialog"]')
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        void safe(() => run("set_selection", { ids: photos.map((p) => p.id) }));
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (!busy) void safe(() => action(event.shiftKey ? "redo" : "undo"));
      } else if (event.key === "ArrowRight") navigate(1);
      else if (event.key === "ArrowLeft") navigate(-1);
      else if (event.key.toLowerCase() === "j" && view === "editor")
        setClipping((previous) => ({
          shadows: !(previous.shadows && previous.highlights),
          highlights: !(previous.shadows && previous.highlights),
        }));
      else if (event.key.toLowerCase() === "g") setView("gallery");
      else if (event.key.toLowerCase() === "e" && photo) {
        setView("editor");
        if (section === "jobs") setSection("all");
      } else if (event.key === "Escape") setView("gallery");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        void safe(() =>
          importPaths(api.pathsForFiles(Array.from(e.dataTransfer.files))),
        );
      }}
    >
      <header className="app-header">
        <div className="brand">
          <SlidersHorizontal size={20} />
          <strong>Lumaflux</strong>
          <span>Photo studio</span>
        </div>
        <div className="view-switch">
          <Btn
            className={view === "gallery" ? "active" : ""}
            onClick={() => setView("gallery")}
          >
            <Grid2X2 size={15} />
            Library
          </Btn>
          <Btn
            className={view === "editor" ? "active" : ""}
            disabled={!photo}
            onClick={() => {
              setView("editor");
              if (section === "jobs") setSection("all");
            }}
          >
            <ImageIcon size={15} />
            Edit
          </Btn>
        </div>
        <div className="header-actions">
          <Btn onClick={() => setAgentOpen(true)}>
            <Bot size={16} />
            Agents
          </Btn>
          <Btn
            className="primary"
            disabled={!state.selection.length}
            onClick={() => setExportOpen(true)}
          >
            <Download size={15} />
            Export
            {state.selection.length > 0 ? ` (${state.selection.length})` : ""}
          </Btn>
        </div>
      </header>
      <div className="workspace">
        {view === "gallery" && (
          <>
            <aside className="navigation panel" style={{ width: leftWidth }}>
              <h2>Library</h2>
              <button
                className={`nav-item ${section === "all" ? "selected" : ""}`}
                onClick={() => {
                  setSection("all");
                  setView("gallery");
                }}
              >
                <Images size={16} />
                All photos<span>{state.photos.length}</span>
              </button>
              <button
                className={`nav-item ${section === "favorites" ? "selected" : ""}`}
                onClick={() => {
                  setSection("favorites");
                  setView("gallery");
                }}
              >
                <Heart size={16} />
                Favorites
                <span>{state.photos.filter((p) => p.favorite).length}</span>
              </button>
              <button
                className={`nav-item ${section === "jobs" ? "selected" : ""}`}
                onClick={() => {
                  setSection("jobs");
                  setView("gallery");
                }}
              >
                <ArrowDownToLine size={16} />
                Exports<span>{state.jobs.length}</span>
              </button>
              <h2>Folders</h2>
              <div className="folder-list">
                {folders.length ? (
                  folders.map((folder) => (
                    <button
                      title={folder}
                      className={`nav-item ${section === folder ? "selected" : ""}`}
                      key={folder}
                      onClick={() => {
                        setSection(folder);
                        setView("gallery");
                      }}
                    >
                      <FolderOpen size={15} />
                      <span className="folder-name">
                        {folder.split(/[\\/]/).pop()}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted small">Imported folders appear here.</p>
                )}
              </div>
              <FolderBrowser onImport={importPaths} onError={setNotice} />
              <div className="import-actions">
                <Btn
                  className="wide"
                  disabled={busy}
                  onClick={() =>
                    safe(async () => importPaths(await api.chooseImport()))
                  }
                >
                  <Plus size={16} />
                  Import photos
                </Btn>
                <Btn
                  className="wide quiet"
                  disabled={busy}
                  onClick={() =>
                    safe(async () => importPaths(await api.chooseImport(true)))
                  }
                >
                  <FolderOpen size={15} />
                  Import folder
                </Btn>
              </div>
            </aside>
            <PanelResize
              side="left"
              width={leftWidth}
              onChange={setLeftWidth}
            />
          </>
        )}
        <main className="main-area">
          {section === "jobs" ? (
            <div className="jobs-view">
              <h1>Exports</h1>
              <p className="muted">
                Edited copies and batch progress from this session.
              </p>
              {!state.jobs.length && (
                <p className="empty-jobs">
                  Select photos, then choose Export to create your first batch.
                </p>
              )}
              {state.jobs.map((job) => (
                <article className="job" key={job.id}>
                  <div className="inline">
                    <strong>
                      {job.total} photo{job.total === 1 ? "" : "s"}
                    </strong>
                    <span className={`job-status ${job.status}`}>
                      {job.status}
                    </span>
                    <span className="spacer" />
                    {["queued", "running"].includes(job.status) && (
                      <Btn
                        onClick={() =>
                          safe(() => run("cancel_export_job", { id: job.id }))
                        }
                      >
                        Cancel
                      </Btn>
                    )}
                  </div>
                  <progress max={job.total} value={job.done} />
                  <p className="muted small">
                    {job.done} / {job.total} processed · {job.errors.length}{" "}
                    error(s)
                  </p>
                  {job.outputs.map((p) => (
                    <p className="output-path" key={p}>
                      {p}
                    </p>
                  ))}
                  {job.errors.map((e, i) => (
                    <p className="error" key={i}>
                      {e.message}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <>
              {view === "gallery" && (
                <div className="library-toolbar">
                  <div>
                    <h1>
                      {section === "all"
                        ? "All photos"
                        : section === "favorites"
                          ? "Favorites"
                          : section.split(/[\\/]/).pop()}
                    </h1>
                    <span className="muted small">
                      {photos.length} photo{photos.length === 1 ? "" : "s"}
                      {state.selection.length
                        ? ` · ${state.selection.length} selected`
                        : ""}
                    </span>
                  </div>
                  <span className="spacer" />
                  {view === "gallery" ? (
                    <>
                      <div className="search">
                        <Search size={15} />
                        <input
                          aria-label="Search photos"
                          placeholder="Search photos"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <select
                        aria-label="Sort photos"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="name">Name</option>
                        <option value="date">Newest</option>
                        <option value="rating">Rating</option>
                      </select>
                      <select
                        aria-label="Minimum rating"
                        value={minRating}
                        onChange={(e) => setMinRating(Number(e.target.value))}
                      >
                        <option value={0}>All ratings</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}+ stars
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <Btn
                        aria-label="Previous photo"
                        disabled={activeIndex <= 0}
                        onClick={() => navigate(-1)}
                      >
                        <ChevronLeft size={16} />
                      </Btn>
                      <Btn
                        aria-label="Next photo"
                        disabled={activeIndex >= photos.length - 1}
                        onClick={() => navigate(1)}
                      >
                        <ChevronRight size={16} />
                      </Btn>
                    </>
                  )}
                </div>
              )}
              {view === "editor" && photo && recipe ? (
                <>
                  <Viewer
                    photo={photo}
                    onHistogram={receiveHistogram}
                    onSample={receiveSample}
                    clipping={{
                      shadows: clipping.shadows || clipHover === "shadows",
                      highlights:
                        clipping.highlights || clipHover === "highlights",
                    }}
                    busy={busy}
                    onAction={(name) => void safe(() => action(name))}
                    composition={tab === "Composition"}
                    aspect={aspect}
                    locked={locked}
                    previous={() => navigate(-1)}
                    next={() => navigate(1)}
                    canPrevious={activeIndex > 0}
                    canNext={activeIndex < photos.length - 1}
                    recipe={recipe}
                    preview={api.preview}
                    onCrop={(crop) => void commit({ crop })}
                    onError={setNotice}
                  />
                  {photo.missing && (
                    <Btn
                      onClick={() =>
                        safe(async () => {
                          const p = await api.chooseRelink();
                          if (p) await run("relink", { id: photo.id, path: p });
                        })
                      }
                    >
                      <Link size={15} />
                      Relink original
                    </Btn>
                  )}
                  <div className="filmstrip">
                    {photos.map((p) => (
                      <button
                        key={p.id}
                        title={p.name}
                        className={p.id === activeId ? "active" : ""}
                        onClick={(e) => select(p, e)}
                      >
                        <img
                          src={api.assetUrl(p.id, p.revision)}
                          alt={p.name}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </>
              ) : photos.length ? (
                <>
                  <div
                    className="gallery"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill,minmax(${thumbSize}px,1fr))`,
                    }}
                  >
                    {photos.map((p) => (
                      <div
                        key={p.id}
                        className={`photo-tile ${selected.has(p.id) ? "selected" : ""} ${p.id === activeId ? "focused" : ""}`}
                      >
                        <button
                          className="photo-image"
                          aria-label={`Select ${p.name}`}
                          onClick={(e) => select(p, e)}
                          onDoubleClick={() => {
                            setActiveId(p.id);
                            setView("editor");
                          }}
                        >
                          <img
                            src={api.assetUrl(p.id, p.revision)}
                            alt={p.name}
                            loading="lazy"
                          />
                          {selected.has(p.id) && (
                            <span className="selection-check">
                              <Check size={13} />
                            </span>
                          )}
                          {p.missing && (
                            <span className="missing-label">
                              Missing original
                            </span>
                          )}
                        </button>
                        <div className="tile-info">
                          <span title={p.name}>{p.name}</span>
                          <button
                            aria-label={`Favorite ${p.name}`}
                            aria-pressed={p.favorite}
                            onClick={() =>
                              safe(() =>
                                run("update_metadata", {
                                  id: p.id,
                                  favorite: !p.favorite,
                                }),
                              )
                            }
                          >
                            <Heart
                              size={14}
                              fill={p.favorite ? "currentColor" : "none"}
                            />
                          </button>
                        </div>
                        <div className="tile-bottom">
                          <span>
                            {p.width} × {p.height}
                          </span>
                          <div className="stars">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                aria-label={`Rate ${p.name} ${n}`}
                                onClick={() =>
                                  safe(() =>
                                    run("update_metadata", {
                                      id: p.id,
                                      rating: p.rating === n ? 0 : n,
                                    }),
                                  )
                                }
                              >
                                <Star
                                  size={11}
                                  fill={p.rating >= n ? "currentColor" : "none"}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="gallery-footer">
                    <Btn
                      className="quiet"
                      onClick={() =>
                        safe(() =>
                          run("set_selection", {
                            ids: photos.map((p) => p.id),
                          }),
                        )
                      }
                    >
                      Select all
                    </Btn>
                    <Btn
                      className="quiet"
                      disabled={!state.selection.length}
                      onClick={() =>
                        safe(() => run("set_selection", { ids: [] }))
                      }
                    >
                      Clear selection
                    </Btn>
                    <span className="spacer" />
                    <label>
                      Thumbnail size
                      <input
                        aria-label="Thumbnail size"
                        type="range"
                        min={140}
                        max={280}
                        value={thumbSize}
                        onChange={(e) => setThumbSize(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Images size={42} strokeWidth={1} />
                  <h2>
                    {state.photos.length
                      ? "No matching photos"
                      : "A little room for your photos."}
                  </h2>
                  <p>
                    {state.photos.length
                      ? "Try another search or folder."
                      : "Import photos or drop a folder here to start editing."}
                  </p>
                  {!state.photos.length && (
                    <Btn
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        safe(async () => importPaths(await api.chooseImport()))
                      }
                    >
                      <Plus size={16} />
                      Import photos
                    </Btn>
                  )}
                  <span>JPEG · PNG · WebP · TIFF · RAW</span>
                </div>
              )}
            </>
          )}
        </main>
        {view === "editor" && (
          <>
            <PanelResize
              side="right"
              width={rightWidth}
              onChange={(w) => setRightWidth(Math.max(240, w))}
            />
            <div className="inspector-shell" style={{ width: rightWidth }}>
              <Adjustments
                histogramData={
                  histogramFrame?.id === photo?.id
                    ? (histogramFrame?.data ?? null)
                    : null
                }
                pixelSample={pixelSample}
                clipping={clipping}
                onClipHover={setClipHover}
                onClipping={(kind) =>
                  setClipping((previous) => ({
                    ...previous,
                    [kind]: !previous[kind],
                  }))
                }
                tab={tab}
                onTab={setTab}
                aspect={aspect}
                onAspect={(v) => {
                  setAspect(v);
                  setLocked(v !== "free");
                }}
                locked={locked}
                onLocked={setLocked}
                photo={photo}
                recipe={recipe}
                onDraft={setDraft}
                onCommit={(patch, revision) => void commit(patch, revision)}
                onAction={(name) => void safe(() => action(name))}
                copied={!!clipboard}
                busy={busy}
              />
            </div>
          </>
        )}
      </div>
      <footer className="statusbar">
        <span>{busy ? "Working…" : ready ? "Ready" : "Opening library…"}</span>
        <span>
          {state.activity[0]?.source === "MCP"
            ? `Agent: ${state.activity[0].action}`
            : "G Library · E Edit · Arrow keys Navigate · ⌘Z Undo"}
        </span>
      </footer>
      {notice && (
        <div className="notice" role="status">
          <p>{notice}</p>
          <Btn aria-label="Dismiss notification" onClick={() => setNotice("")}>
            <X size={16} />
          </Btn>
        </div>
      )}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        count={state.selection.length}
        api={api}
        onExport={async (options) => {
          await run("export_photos", { ...options, ids: state.selection });
          setSection("jobs");
          setView("gallery");
        }}
      />
      <AgentDialog
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        api={api}
      />
    </div>
  );
}
