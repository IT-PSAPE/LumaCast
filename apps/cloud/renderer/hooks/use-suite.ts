// Wires one `CloudDesktopAPI` (real or mock) into React state: an initial
// load of the overview and the operation list, then live updates through
// `onOverview`/`onOperation` for as long as the component stays mounted.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudDesktopAPI, OperationSnapshot, SuiteOverview } from '../../shared/desktop-api';
import { getApi } from '../api';

export interface UseSuiteResult {
  overview: SuiteOverview | null;
  operations: OperationSnapshot[];
  refresh: () => Promise<void>;
  api: CloudDesktopAPI;
}

export function useSuite(api: CloudDesktopAPI = getApi()): UseSuiteResult {
  const [overview, setOverview] = useState<SuiteOverview | null>(null);
  const [operationsById, setOperationsById] = useState<ReadonlyMap<string, OperationSnapshot>>(new Map());

  useEffect(() => {
    let cancelled = false;

    void api.overview().then((next) => {
      if (!cancelled) setOverview(next);
    });
    void api.operations().then((next) => {
      if (!cancelled) setOperationsById(new Map(next.map((operation) => [operation.id, operation])));
    });

    const unsubscribeOverview = api.onOverview((next) => {
      if (!cancelled) setOverview(next);
    });
    const unsubscribeOperation = api.onOperation((operation) => {
      if (cancelled) return;
      setOperationsById((previous) => {
        const next = new Map(previous);
        next.set(operation.id, operation);
        return next;
      });
    });

    return () => {
      cancelled = true;
      unsubscribeOverview();
      unsubscribeOperation();
    };
  }, [api]);

  const operations = useMemo(
    () => Array.from(operationsById.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [operationsById],
  );

  const refresh = useCallback(async () => {
    const next = await api.refresh();
    setOverview(next);
  }, [api]);

  return { overview, operations, refresh, api };
}
