import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createMockApi } from "../../../../../apps/cloud/renderer/mock-api";
import { useSuite } from "../../../../../apps/cloud/renderer/hooks/use-suite";
import { useManagedActionOwner } from "../../../../../apps/cloud/renderer/hooks/use-cloud-actions";
import { useManagedActions } from "../../../../../apps/cloud/renderer/hooks/use-managed-actions";
import { AppsScreen } from "../../../../../apps/cloud/renderer/screens/apps-screen";
import { UpdatesScreen } from "../../../../../apps/cloud/renderer/screens/updates-screen";
import { SettingsScreen } from "../../../../../apps/cloud/renderer/screens/settings-screen";
import type { CloudDesktopAPI, CloudSettings, OperationSnapshot, SuiteOverview } from "../../../../../apps/cloud/shared/desktop-api";
import type { SuiteAppId } from "@lumacast/suite";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function operation(app: SuiteAppId, status: OperationSnapshot["status"] = "done"): OperationSnapshot {
  return { id: `owned-${app}`, app, kind: "install", version: "1.0.0", status,
    progress: { transferred: 0, total: null, percent: null, bytesPerSecond: null }, error: null,
    startedAt: new Date(0).toISOString(), finishedAt: status === "queued" ? null : new Date(1).toISOString() };
}
function Harness({ api, view = "apps" }: { api: CloudDesktopAPI; view?: "apps" | "updates" | "settings" }) {
  const suite = useSuite(api);
  const actions = useManagedActionOwner(api, suite.operations);
  if (!suite.overview) return null;
  if (view === "settings") return <SettingsScreen api={api} overview={suite.overview} />;
  if (view === "updates") return <UpdatesScreen api={api} overview={suite.overview} actions={actions} />;
  return <AppsScreen api={api} overview={suite.overview} operations={suite.operations} refresh={suite.refresh} actions={actions} />;
}
const card = (name: string) => screen.getByRole("group", { name });

describe("Cloud action recovery", () => {
  it("shows an install rejection, keeps canonical state and retries exactly once", async () => {
    const api = createMockApi(); await api.grant("flux");
    const install = vi.spyOn(api, "install").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(operation("flux"));
    render(<Harness api={api} />);
    fireEvent.click(within(await screen.findByRole("group", { name: "Lumaflux" })).getByRole("button", { name: "Install" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Could not install Lumaflux. disk full");
    expect(within(card("Lumaflux")).getByText("Not installed")).toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install).toHaveBeenLastCalledWith("flux", undefined);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("keeps removal consent and data choice in the retry payload", async () => {
    const api = createMockApi(); await api.grant("cast");
    const uninstall = vi.spyOn(api, "uninstall").mockRejectedValueOnce(new Error("access denied")).mockResolvedValue(operation("cast"));
    render(<Harness api={api} />);
    fireEvent.click(within(await screen.findByRole("group", { name: "LumaCast" })).getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Uninstall…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also delete its data" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Could not remove LumaCast and its data. access denied");
    expect(within(card("LumaCast")).getByText(/Update available/)).toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(uninstall).toHaveBeenCalledTimes(2));
    expect(uninstall.mock.calls).toEqual([["cast", { removeUserData: true }], ["cast", { removeUserData: true }]]);
  });

  it.each([
    ["Check for updates on launch", { checkOnLaunch: false }],
    ["Check for updates in background", { checkInBackground: false }],
    ["All users", { installScope: "system" }],
  ] as const)("recovers a rejected %s save without optimistic state", async (label, patch) => {
    const api = createMockApi();
    const save = vi.spyOn(api, "updateSettings").mockRejectedValueOnce(new Error("Could not write settings: disk full"));
    render(<Harness api={api} view="settings" />);
    const control = await screen.findByRole(label === "All users" ? "button" : "switch", { name: label });
    fireEvent.click(control);
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Could not save settings. Could not write settings: disk full");
    if (label === "All users") expect(control).toHaveAttribute("aria-pressed", "false");
    else expect(control).toBeChecked();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls).toEqual([[patch], [patch]]);
    await waitFor(() => {
      if (label === "All users") expect(control).toHaveAttribute("aria-pressed", "true");
      else expect(control).not.toBeChecked();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains a rejected permission revoke and retries the same app", async () => {
    const api = createMockApi(); await api.grant("cast");
    const revoke = vi.spyOn(api, "revoke").mockRejectedValueOnce(new Error("permission store is read-only"));
    render(<Harness api={api} view="settings" />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Could not revoke access for LumaCast. permission store is read-only");
    expect(screen.getByText("LumaCast")).toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("LumaCast")).not.toBeInTheDocument());
    expect(revoke.mock.calls).toEqual([["cast"], ["cast"]]);
  });

  it("serializes pending settings clicks and suppresses a replaced API's late save error", async () => {
    const api = createMockApi(); const other = createMockApi();
    const reply = deferred<CloudSettings>();
    const save = vi.spyOn(api, "updateSettings").mockReturnValueOnce(reply.promise);
    const view = render(<Harness api={api} view="settings" />);
    const toggle = await screen.findByRole("switch", { name: "Check for updates in background" });
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect(save).toHaveBeenCalledOnce(); expect(toggle).toBeChecked(); expect(toggle).toHaveAttribute("aria-disabled", "true");
    view.rerender(<Harness api={other} view="settings" />);
    await screen.findByRole("switch", { name: "Check for updates in background" });
    await act(async () => reply.reject(new Error("retired save failure")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Check for updates in background" })).toBeChecked();
  });

  it("shows individual Updates failures and retries the same managed app", async () => {
    const api = createMockApi(); await api.grant("cast");
    const install = vi.spyOn(api, "install").mockRejectedValueOnce(new Error("release missing")).mockResolvedValue(operation("cast"));
    render(<Harness api={api} view="updates" />);
    const name = await screen.findByText("LumaCast");
    fireEvent.click(within(name.closest("div")!.parentElement!).getByRole("button", { name: "Update" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Could not install LumaCast. release missing");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install.mock.calls).toEqual([["cast", undefined], ["cast", undefined]]);
  });

  it("keeps Update all's permission requests for every managed app", async () => {
    const api = createMockApi(); const overview = await api.overview();
    overview.apps.find((app) => app.app === "flux")!.status = "update-available";
    overview.selfUpdate.status = "idle";
    vi.spyOn(api, "overview").mockResolvedValue(overview);
    const grant = vi.spyOn(api, "grant").mockResolvedValue(overview.settings);
    const install = vi.spyOn(api, "install").mockImplementation(async (app) => operation(app));
    render(<Harness api={api} view="updates" />);
    fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
    expect(await screen.findByText("Allow LumaCloud to manage LumaCast?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(await screen.findByText("Allow LumaCloud to manage Lumaflux?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(grant.mock.calls).toEqual([["cast"], ["flux"]]);
    expect(install.mock.calls).toEqual([["cast", undefined], ["flux", undefined]]);
  });

  it("grants once, reports grant failure, and checks current grants on retry", async () => {
    const api = createMockApi();
    const grantReply = deferred<CloudSettings>();
    const grant = vi.spyOn(api, "grant").mockReturnValueOnce(grantReply.promise);
    const install = vi.spyOn(api, "install").mockResolvedValue(operation("flux"));
    render(<Harness api={api} />);
    fireEvent.click(within(await screen.findByRole("group", { name: "Lumaflux" })).getByRole("button", { name: "Install" }));
    const allow = screen.getByRole("button", { name: "Allow" });
    fireEvent.click(allow); fireEvent.click(allow);
    expect(grant).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    await act(async () => grantReply.reject(new Error("cannot persist permission")));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("cannot persist permission");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    expect(grant).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("Not now consumes a grant intent before a late %s", async (settlement) => {
    const api = createMockApi(); const overview = await api.overview();
    const grantReply = deferred<CloudSettings>();
    vi.spyOn(api, "grant").mockReturnValue(grantReply.promise);
    const install = vi.spyOn(api, "install");
    render(<Harness api={api} />);
    fireEvent.click(within(await screen.findByRole("group", { name: "Lumaflux" })).getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { if (settlement === "resolve") grantReply.resolve(overview.settings); else grantReply.reject(new Error("retired failure")); });
    expect(install).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps admission locked across Apps/Updates navigation and hides the retired failure", async () => {
    const api = createMockApi(); await api.grant("cast");
    const reply = deferred<OperationSnapshot>(); const install = vi.spyOn(api, "install").mockReturnValueOnce(reply.promise);
    const view = render(<Harness api={api} />);
    fireEvent.click(within(await screen.findByRole("group", { name: "LumaCast" })).getByRole("button", { name: "Update" }));
    view.rerender(<Harness api={api} view="updates" />);
    await waitFor(() => expect(screen.getByText("LumaCast")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Update" }).some((button) => button.hasAttribute("disabled"))).toBe(true);
    view.rerender(<Harness api={api} />);
    const button = within(await screen.findByRole("group", { name: "LumaCast" })).getByRole("button", { name: "Update" });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(install).toHaveBeenCalledOnce();
    await act(async () => reply.reject(new Error("retired screen failure")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("rechecks a stale bulk approval against a newer card admission", async () => {
    const api = createMockApi(); await api.grant("cast");
    const uninstall = vi.spyOn(api, "uninstall");
    render(<Harness api={api} />);
    fireEvent.click(await screen.findByText("LumaCast"));
    fireEvent.click(screen.getByRole("button", { name: "Uninstall (1)" }));
    const review = await screen.findByRole("dialog", { name: "Remove selected apps?" });
    const owner = renderHook(() => useManagedActionOwner(api, []));
    const reply = deferred<OperationSnapshot>(); let work!: Promise<OperationSnapshot | void>;
    act(() => { work = owner.result.current.admit("cast", () => reply.promise); });
    fireEvent.click(within(review).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Stopped at LumaCast.*busy/)).toBeInTheDocument();
    expect(uninstall).not.toHaveBeenCalled();
    await act(async () => { reply.resolve(operation("cast")); await work; });
  });

  it("enables card controls in the terminal render and releases the owned observer", async () => {
    const api = createMockApi(); await api.grant("cast");
    const listeners = new Set<(operation: OperationSnapshot) => void>();
    vi.spyOn(api, "onOperation").mockImplementation((listener) => {
      listeners.add(listener); return () => { listeners.delete(listener); };
    });
    vi.spyOn(api, "install").mockResolvedValue(operation("cast", "queued"));
    render(<Harness api={api} />);
    const cast = await screen.findByRole("group", { name: "LumaCast" });
    fireEvent.click(within(cast).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(listeners.size).toBe(2));
    act(() => listeners.forEach((listener) => listener(operation("cast", "queued"))));
    expect(within(cast).getByRole("progressbar")).toBeInTheDocument();
    act(() => listeners.forEach((listener) => listener(operation("cast"))));
    expect(within(cast).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(listeners.size).toBe(1);
    expect(within(cast).getByRole("button", { name: "Update" })).not.toBeDisabled();
    expect(within(cast).getByRole("button", { name: "More actions" })).not.toBeDisabled();
  });
});

describe("Cloud shared admission and feedback lifetimes", () => {
  function managedHook(api: CloudDesktopAPI, overview: SuiteOverview, initialOperations: OperationSnapshot[] = []) {
    return renderHook(({ currentApi, currentOverview, operations }) => {
      const owner = useManagedActionOwner(currentApi, operations);
      return { owner, managed: useManagedActions(currentApi, currentOverview, owner) };
    }, { initialProps: { currentApi: api, currentOverview: overview, operations: initialOperations } });
  }

  it("retains exact version retry and refuses retry while a current operation is active", async () => {
    const api = createMockApi(); await api.grant("flux"); const overview = await api.overview();
    const install = vi.spyOn(api, "install").mockRejectedValueOnce(new Error("version unavailable")).mockResolvedValue(operation("flux"));
    const hook = managedHook(api, overview);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux", version: "0.1.0" }));
    await waitFor(() => expect(hook.result.current.managed.failures).toHaveLength(1));
    const failure = hook.result.current.managed.failures[0]!;
    const oldRetry = hook.result.current.managed.retry;
    hook.rerender({ currentApi: api, currentOverview: overview, operations: [operation("flux", "queued")] });
    act(() => oldRetry(failure)); expect(install).toHaveBeenCalledOnce();
    hook.rerender({ currentApi: api, currentOverview: overview, operations: [] });
    act(() => hook.result.current.managed.retry(failure));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install.mock.calls).toEqual([["flux", "0.1.0"], ["flux", "0.1.0"]]);
  });

  it("never replays an old failure after a newer same-app admission succeeds", async () => {
    const api = createMockApi(); await api.grant("flux"); const overview = await api.overview();
    const install = vi.spyOn(api, "install").mockRejectedValue(new Error("old failure"));
    const hook = managedHook(api, overview);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux" }));
    await waitFor(() => expect(hook.result.current.managed.failures).toHaveLength(1));
    const failure = hook.result.current.managed.failures[0]!;
    await act(async () => { await hook.result.current.owner.admit("flux", async () => operation("flux")); });
    expect(hook.result.current.managed.failures).toHaveLength(0);
    act(() => hook.result.current.managed.retry(failure)); expect(install).toHaveBeenCalledOnce();
  });

  it("requires permission again when the current grant was revoked before Retry", async () => {
    const api = createMockApi(); await api.grant("flux"); const overview = await api.overview();
    const install = vi.spyOn(api, "install").mockRejectedValue(new Error("first failure"));
    const hook = managedHook(api, overview);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux" }));
    await waitFor(() => expect(hook.result.current.managed.failures).toHaveLength(1));
    const failure = hook.result.current.managed.failures[0]!;
    hook.rerender({ currentApi: api, currentOverview: { ...overview, settings: { ...overview.settings, grants: [] } }, operations: [] });
    act(() => hook.result.current.managed.retry(failure));
    expect(install).toHaveBeenCalledOnce();
    expect(hook.result.current.managed.pending?.action.app).toBe("flux");
  });

  it("keeps a same-object API admission across A/B/A and blocks retired grant follow-on", async () => {
    const api = createMockApi(); const other = createMockApi();
    const overview = await api.overview(); const otherOverview = await other.overview();
    const reply = deferred<CloudSettings>(); vi.spyOn(api, "grant").mockReturnValueOnce(reply.promise);
    const install = vi.spyOn(api, "install");
    const hook = managedHook(api, overview);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux" }));
    act(() => hook.result.current.managed.allow(hook.result.current.managed.pending!));
    hook.rerender({ currentApi: other, currentOverview: otherOverview, operations: [] });
    hook.rerender({ currentApi: api, currentOverview: overview, operations: [] });
    expect(hook.result.current.owner.isBusy("flux")).toBe(true);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux" }));
    expect(hook.result.current.managed.pending).toBeNull();
    await act(async () => reply.resolve(overview.settings));
    expect(install).not.toHaveBeenCalled();
    expect(hook.result.current.owner.isBusy("flux")).toBe(false);
  });

  it("ignores stale permission handlers after a different intent replaces them", async () => {
    const api = createMockApi(); const overview = await api.overview();
    const grant = vi.spyOn(api, "grant");
    const hook = managedHook(api, overview);
    act(() => hook.result.current.managed.request({ kind: "install", app: "flux" }));
    const stale = hook.result.current.managed.pending!;
    act(() => hook.result.current.managed.request({ kind: "uninstall", app: "cast", removeUserData: false }));
    act(() => { hook.result.current.managed.allow(stale); hook.result.current.managed.notNow(stale); });
    expect(hook.result.current.managed.pending?.action.app).toBe("cast");
    expect(grant).not.toHaveBeenCalled();
  });

  it.each([false, true])("tracks queued replies and the terminal-before-reply race (%s) without leaked observers", async (earlyTerminal) => {
    const api = createMockApi(); const listeners = new Set<(operation: OperationSnapshot) => void>();
    vi.spyOn(api, "onOperation").mockImplementation((callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; });
    const hook = renderHook(() => useManagedActionOwner(api, []));
    const reply = deferred<OperationSnapshot>(); let work!: Promise<OperationSnapshot | void>;
    act(() => { work = hook.result.current.admit("cast", () => reply.promise); });
    expect(hook.result.current.isBusy("cast")).toBe(true); expect(listeners.size).toBe(1);
    if (earlyTerminal) act(() => listeners.forEach((listener) => listener(operation("cast"))));
    await act(async () => { reply.resolve(operation("cast", "queued")); await work; });
    expect(hook.result.current.isBusy("cast")).toBe(!earlyTerminal);
    if (!earlyTerminal) act(() => listeners.forEach((listener) => listener(operation("cast"))));
    expect(hook.result.current.isBusy("cast")).toBe(false); expect(listeners.size).toBe(0);
  });
});
