import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SuiteAppId } from "@lumacast/suite";
import type { CloudDesktopAPI, OperationSnapshot } from "../../shared/desktop-api";
import { activeOperationFor } from "../presentation";

const terminal = (operation: OperationSnapshot) =>
  ["done", "failed", "cancelled"].includes(operation.status);

interface Admission {
  operationId?: string;
  latest?: OperationSnapshot;
}

// Admission belongs to the bridge, not a mounted screen. Navigation or reuse
// of the same bridge cannot submit an app twice while its reply is pending.
const owners = new WeakMap<CloudDesktopAPI, ReturnType<typeof createOwner>>();

function createOwner(api: CloudDesktopAPI) {
  const pending = new Map<SuiteAppId, Admission>();
  const revisions = new Map<SuiteAppId, number>();
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  const publish = () => listeners.forEach((listener) => listener());
  const release = (app: SuiteAppId, admission: Admission) => {
    if (pending.get(app) !== admission) return;
    pending.delete(app);
    if (pending.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
    }
    publish();
  };
  return {
    isBusy: (app: SuiteAppId) => pending.has(app),
    busyApps: () => [...pending.keys()],
    revision: (app: SuiteAppId) => revisions.get(app) ?? 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async admit(app: SuiteAppId, work: () => Promise<OperationSnapshot | void>) {
      if (pending.has(app)) throw new Error("This app already has an operation in progress.");
      const admission: Admission = {};
      pending.set(app, admission);
      revisions.set(app, (revisions.get(app) ?? 0) + 1);
      try {
        unsubscribe ??= api.onOperation((operation) => {
          const current = pending.get(operation.app);
          if (!current) return;
          // One latest event per outstanding app handles a terminal push that
          // arrives before its IPC reply, without retaining operation history.
          current.latest = operation;
          if (current.operationId === operation.id && terminal(operation)) {
            release(operation.app, current);
          }
        });
        publish();
        const operation = await work();
        if (operation && !terminal(operation)) {
          admission.operationId = operation.id;
          if (admission.latest?.id !== operation.id || !terminal(admission.latest)) {
            return operation;
          }
        }
        release(app, admission);
        return operation;
      } catch (error) {
        release(app, admission);
        throw error;
      }
    },
  };
}

export function useManagedActionOwner(api: CloudDesktopAPI, operations: OperationSnapshot[]) {
  const currentOperations = useRef(operations);
  useLayoutEffect(() => { currentOperations.current = operations; }, [operations]);
  const owner = useMemo(() => {
    let current = owners.get(api);
    if (!current) { current = createOwner(api); owners.set(api, current); }
    return current;
  }, [api]);
  const [, render] = useState(0);
  useEffect(() => owner.subscribe(() => render((value) => value + 1)), [owner]);
  return {
    admit: owner.admit,
    revision: owner.revision,
    // Render from the current snapshot. The ref below is for event handlers
    // captured by an older render, and is only refreshed after this render.
    busyApps: new Set([...owner.busyApps(), ...operations.filter((operation) => !terminal(operation)).map((operation) => operation.app)]),
    // Existing operations are seeded by useSuite; owned replies cover the gap
    // before a queued push and remain owned until their terminal push.
    isBusy: (app: SuiteAppId) => owner.isBusy(app) || Boolean(activeOperationFor(app, currentOperations.current)),
  };
}

export type ManagedActionOwner = ReturnType<typeof useManagedActionOwner>;

export interface ActionFailure<Action> {
  key: string;
  action: Action;
  message: string;
}

export function useActionFeedback<Action>(api: CloudDesktopAPI) {
  const session = useMemo(() => ({
    active: false,
    pending: new Map<string, object>(),
    failures: new Map<string, ActionFailure<Action>>(),
  }), [api]);
  const [snapshot, setSnapshot] = useState({ session, failures: [] as ActionFailure<Action>[] });
  const publish = () => {
    if (session.active) setSnapshot({ session, failures: [...session.failures.values()] });
  };
  useEffect(() => {
    session.active = true;
    setSnapshot({ session, failures: [] });
    return () => { session.active = false; session.pending.clear(); };
  }, [session]);
  return {
    ready: session.active,
    isActive: () => session.active,
    failures: snapshot.session === session && session.active ? snapshot.failures : [],
    isBusy: (key: string) => session.pending.has(key),
    dismiss(failure: ActionFailure<Action>) {
      if (session.failures.get(failure.key) !== failure) return;
      session.failures.delete(failure.key);
      publish();
    },
    cancel(key: string) {
      session.pending.delete(key);
      publish();
    },
    async run(key: string, action: Action, label: string,
      work: (api: CloudDesktopAPI, isCurrent: () => boolean) => Promise<unknown>) {
      if (!session.active || session.pending.has(key)) return;
      const token = {};
      const isCurrent = () => session.active && session.pending.get(key) === token;
      session.pending.set(key, token);
      session.failures.delete(key);
      publish();
      try {
        await work(api, isCurrent);
      } catch (error) {
        if (isCurrent()) {
          const detail = error instanceof Error && error.message ? error.message : "Try again.";
          session.failures.set(key, { key, action, message: `${label} ${detail}` });
        }
      } finally {
        if (isCurrent()) { session.pending.delete(key); publish(); }
      }
    },
  };
}
