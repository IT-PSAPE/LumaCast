// The desktop bridge owns suite data. Subscribe before reading its snapshots
// so a delayed reply cannot replace updates received while it was in flight.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CloudDesktopAPI,
  OperationSnapshot,
  SuiteOverview,
} from "../../shared/desktop-api";
import { getApi } from "../api";

export interface UseSuiteResult {
  overview: SuiteOverview | null;
  operations: OperationSnapshot[];
  loading: boolean;
  operationsLoading: boolean;
  refreshing: boolean;
  operationsError: string | null;
  error: { source: "overview" | "operations" | "refresh"; message: string } | null;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
  api: CloudDesktopAPI;
}

interface SuiteState {
  api: CloudDesktopAPI;
  overview: SuiteOverview | null;
  operationsById: ReadonlyMap<string, OperationSnapshot>;
  loading: boolean;
  operationsLoading: boolean;
  refreshing: boolean;
  overviewError: string | null;
  operationsError: string | null;
  refreshError: string | null;
}

interface SuiteSession {
  api: CloudDesktopAPI;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
}

function initialState(api: CloudDesktopAPI): SuiteState {
  return {
    api,
    overview: null,
    operationsById: new Map(),
    loading: true,
    operationsLoading: true,
    refreshing: false,
    overviewError: null,
    operationsError: null,
    refreshError: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Try again.";
}

export function useSuite(api: CloudDesktopAPI = getApi()): UseSuiteResult {
  const [state, setState] = useState(() => initialState(api));
  const sessionRef = useRef<SuiteSession | null>(null);

  useEffect(() => {
    let active = true;
    let overviewRequest = 0;
    let overviewRevision = 0;
    let operationsRequest = 0;
    let operationRevision = 0;
    const pushedOperationRevisions = new Map<string, number>();
    const update = (mutate: (previous: SuiteState) => SuiteState) => {
      if (active) setState((previous) => active ? mutate(previous) : previous);
    };

    setState(initialState(api));

    async function readOverview(refresh: boolean): Promise<void> {
      if (!active) return;
      const request = ++overviewRequest;
      const revision = overviewRevision;
      update((previous) => ({
        ...previous,
        loading: previous.overview === null,
        refreshing: refresh,
        overviewError: null,
        refreshError: null,
      }));
      try {
        const next = await (refresh ? api.refresh() : api.overview());
        if (!active || request !== overviewRequest) return;
        update((previous) => ({
          ...previous,
          overview: revision === overviewRevision ? next : previous.overview,
          loading: false,
          refreshing: false,
        }));
      } catch (error) {
        if (!active || request !== overviewRequest) return;
        const message = revision === overviewRevision ? errorMessage(error) : null;
        update((previous) => ({
          ...previous,
          loading: false,
          refreshing: false,
          overviewError: refresh || message === null ? null : `Could not load apps. ${message}`,
          refreshError: refresh && message !== null ? `Could not refresh apps. ${message}` : null,
        }));
      }
    }

    async function readOperations(): Promise<void> {
      if (!active) return;
      const request = ++operationsRequest;
      const revision = operationRevision;
      update((previous) => ({ ...previous, operationsLoading: true, operationsError: null }));
      try {
        const next = await api.operations();
        if (!active || request !== operationsRequest) return;
        update((previous) => {
          const operationsById = new Map(next.map((operation) => [operation.id, operation]));
          for (const [id, pushedRevision] of pushedOperationRevisions) {
            const operation = previous.operationsById.get(id);
            if (pushedRevision > revision && operation) operationsById.set(id, operation);
          }
          return { ...previous, operationsById, operationsLoading: false, operationsError: null };
        });
      } catch (error) {
        if (!active || request !== operationsRequest) return;
        update((previous) => ({
          ...previous,
          operationsLoading: false,
          operationsError: `Could not load activity. ${errorMessage(error)}`,
        }));
      }
    }

    const session: SuiteSession = {
      api,
      retry: async () => { await Promise.all([readOverview(false), readOperations()]); },
      refresh: () => readOverview(true),
    };
    sessionRef.current = session;

    const unsubscribeOverview = api.onOverview((next) => {
      if (!active) return;
      overviewRevision += 1;
      update((previous) => ({
        ...previous,
        overview: next,
        loading: false,
        overviewError: null,
        refreshError: null,
      }));
    });
    const unsubscribeOperation = api.onOperation((operation) => {
      if (!active) return;
      pushedOperationRevisions.set(operation.id, ++operationRevision);
      update((previous) => {
        const operationsById = new Map(previous.operationsById);
        operationsById.set(operation.id, operation);
        return { ...previous, operationsById };
      });
    });
    void session.retry();

    return () => {
      active = false;
      if (sessionRef.current === session) sessionRef.current = null;
      unsubscribeOverview();
      unsubscribeOperation();
    };
  }, [api]);

  const retry = useCallback(async () => {
    if (sessionRef.current?.api === api) await sessionRef.current.retry();
  }, [api]);
  const refresh = useCallback(async () => {
    if (sessionRef.current?.api === api) await sessionRef.current.refresh();
  }, [api]);

  // An API replacement must not expose the previous session for one render
  // while its effect cleanup and the new session's initial reads run.
  const current = state.api === api ? state : initialState(api);
  const operations = useMemo(
    () => Array.from(current.operationsById.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [current.operationsById],
  );

  return {
    overview: current.overview,
    operations,
    loading: current.loading,
    operationsLoading: current.operationsLoading,
    refreshing: current.refreshing,
    operationsError: current.operationsError,
    error: current.overviewError
      ? { source: "overview", message: current.overviewError }
      : current.operationsError
        ? { source: "operations", message: current.operationsError }
        : current.refreshError
          ? { source: "refresh", message: current.refreshError }
          : null,
    retry,
    refresh,
    api,
  };
}
