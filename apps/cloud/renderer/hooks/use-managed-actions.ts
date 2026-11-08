import { useEffect, useRef, useState } from "react";
import { suiteApp, type SuiteAppId } from "@lumacast/suite";
import type { CloudDesktopAPI, SuiteOverview } from "../../shared/desktop-api";
import { useActionFeedback, type ActionFailure, type ManagedActionOwner } from "./use-cloud-actions";

export type ManagedAction =
  | { kind: "install"; app: SuiteAppId; version?: string }
  | { kind: "uninstall"; app: SuiteAppId; removeUserData: boolean }
  | { kind: "open"; app: SuiteAppId };
interface Attempt { action: ManagedAction; revision: number }
interface PermissionIntent { action: ManagedAction }

export function useManagedActions(api: CloudDesktopAPI, overview: SuiteOverview,
  owner: ManagedActionOwner, disabled: () => boolean = () => false) {
  const feedback = useActionFeedback<Attempt>(api);
  const [pending, setPending] = useState<PermissionIntent | null>(null);
  const pendingRef = useRef<PermissionIntent | null>(null);
  const queue = useRef<PermissionIntent[]>([]);
  useEffect(() => {
    pendingRef.current = null;
    queue.current = [];
    setPending(null);
    return () => { pendingRef.current = null; queue.current = []; };
  }, [api]);
  const close = (intent: PermissionIntent) => {
    if (pendingRef.current !== intent) return;
    const next = queue.current.shift() ?? null;
    pendingRef.current = next;
    setPending(next);
  };
  const execute = (action: ManagedAction, intent?: PermissionIntent) => {
    if (!feedback.isActive() || disabled() || owner.isBusy(action.app)) return;
    const name = suiteApp(action.app).productName;
    const label = action.kind === "uninstall"
      ? `Could not remove ${name}${action.removeUserData ? " and its data" : ""}.`
      : action.kind === "open" ? `Could not open ${name}.`
        : `Could not install ${name}${action.version ? ` ${action.version}` : ""}.`;
    const attempt = { action, revision: owner.revision(action.app) + 1 };
    void feedback.run(action.app, attempt, label, async (current, isCurrent) => {
      await owner.admit(action.app, async () => {
        if (intent) {
          try { await current.grant(action.app); }
          catch (error) { if (isCurrent()) close(intent); throw error; }
          if (!isCurrent() || pendingRef.current !== intent) return;
          close(intent);
        }
        if (!isCurrent()) return;
        const operation = action.kind === "install" ? await current.install(action.app, action.version)
          : action.kind === "uninstall" ? await current.uninstall(action.app, { removeUserData: action.removeUserData })
            : await current.open(action.app);
        if (operation?.status === "failed") throw new Error(operation.error ?? "The operation failed.");
        return operation;
      });
    });
  };
  const request = (action: ManagedAction, enqueue = false) => {
    if (!feedback.isActive() || disabled() || owner.isBusy(action.app)) return;
    if (overview.settings.grants.some((grant) => grant.app === action.app)) execute(action);
    else {
      const intent = { action };
      if (enqueue && pendingRef.current) {
        if (pendingRef.current.action.app !== action.app && !queue.current.some((entry) => entry.action.app === action.app)) queue.current.push(intent);
        return;
      }
      queue.current = [];
      pendingRef.current = intent;
      setPending(intent);
    }
  };
  return {
    ready: feedback.ready,
    request,
    failures: feedback.failures.filter((failure) => owner.revision(failure.action.action.app) === failure.action.revision),
    dismiss: feedback.dismiss,
    retry(failure: ActionFailure<Attempt>) {
      if (owner.revision(failure.action.action.app) === failure.action.revision) request(failure.action.action);
    },
    pending: feedback.ready ? pending : null,
    allowing: pending !== null && feedback.isBusy(pending.action.app),
    allow(intent: PermissionIntent) {
      if (pendingRef.current === intent) execute(intent.action, intent);
    },
    notNow(intent: PermissionIntent) {
      if (pendingRef.current !== intent) return;
      feedback.cancel(intent.action.app);
      close(intent);
    },
  };
}
