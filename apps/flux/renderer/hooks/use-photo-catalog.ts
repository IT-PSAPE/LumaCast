import { useEffect, useState } from "react";
import type { AppState } from "@lumacast/photo-model";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { PhotoCommand } from "../../shared/photo-command";

type CatalogStatus = "loading" | "ready" | "error";

interface CatalogSession {
  isActive: () => boolean;
  refresh: () => Promise<AppState>;
  run: PhotoCommand;
  /** Confirmed data for imperative recovery; null after this session ends. */
  getSnapshot: () => AppState | null;
}

interface CatalogState {
  api: DesktopAPI;
  state: AppState;
  status: CatalogStatus;
  error: string | null;
  session: CatalogSession | null;
}

function initialCatalog(api: DesktopAPI): CatalogState {
  return {
    api,
    state: { photos: [], selection: [], jobs: [], activity: [] },
    status: "loading",
    error: null,
    session: null,
  };
}

function inactiveSession(): Error {
  return new Error("The photo catalog session is no longer active.");
}
const inactiveRefresh = async (): Promise<AppState> => { throw inactiveSession(); };
const inactiveRun: PhotoCommand = async () => { throw inactiveSession(); };
const noSnapshot = () => null;

/** Owns catalog transport and snapshot authority, not editor or selection intent. */
export function usePhotoCatalog(api: DesktopAPI) {
  const [catalog, setCatalog] = useState(() => initialCatalog(api));

  useEffect(() => {
    let active = true;
    let requestSequence = 0;
    let localCommands = 0;
    let snapshot: AppState | null = null;
    const update = (change: (previous: CatalogState) => CatalogState) => {
      if (active) setCatalog((previous) =>
        active && previous.session === session ? change(previous) : previous,
      );
    };

    async function refresh(): Promise<AppState> {
      if (!active) throw inactiveSession();
      const request = ++requestSequence;
      update((previous) => ({
        ...previous,
        status: previous.status === "ready" ? "ready" : "loading",
        error: null,
      }));
      try {
        const next = await api.command("get_app_state");
        if (!active) throw inactiveSession();
        if (request !== requestSequence) throw new Error("A newer catalog refresh superseded this response.");
        snapshot = next;
        update((previous) => ({ ...previous, state: next, status: "ready", error: null }));
        return next;
      } catch (error) {
        if (active && request === requestSequence) {
          update((previous) => ({
            ...previous,
            status: snapshot === null ? "error" : "ready",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
        throw error;
      }
    }

    const run: PhotoCommand = async (...request) => {
      if (!active) throw inactiveSession();
      localCommands += 1;
      try {
        return await api.command<typeof request>(...request);
      } finally {
        // Stop suppressing change events before the read: genuine external
        // updates arriving during that read must start a newer refresh.
        localCommands -= 1;
        if (active) await refresh().catch(() => {});
      }
    };
    const session: CatalogSession = {
      isActive: () => active,
      refresh,
      run,
      getSnapshot: () => active ? snapshot : null,
    };
    setCatalog({ ...initialCatalog(api), session });
    const unsubscribe = api.onChange(() => {
      // The command's own completion reads once; its change event is an echo.
      if (active && localCommands === 0) void refresh().catch(() => {});
    });
    void refresh().catch(() => {});

    return () => {
      active = false;
      requestSequence += 1;
      unsubscribe();
    };
  }, [api]);

  const current = catalog.api === api && catalog.session?.isActive() ? catalog : initialCatalog(api);
  return {
    state: current.state,
    status: current.status,
    error: current.error,
    refresh: current.session?.refresh ?? inactiveRefresh,
    run: current.session?.run ?? inactiveRun,
    getSnapshot: current.session?.getSnapshot ?? noSnapshot,
  };
}
