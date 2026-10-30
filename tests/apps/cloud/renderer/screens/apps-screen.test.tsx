import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockApi } from "../../../../../apps/cloud/renderer/mock-api";
import { useSuite } from "../../../../../apps/cloud/renderer/hooks/use-suite";
import { AppsScreen } from "../../../../../apps/cloud/renderer/screens/apps-screen";
import type { CloudDesktopAPI } from "../../../../../apps/cloud/shared/desktop-api";
import type { OperationSnapshot } from "../../../../../apps/cloud/shared/desktop-api";
import type { SuiteAppId } from "@lumacast/suite";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ api }: { api: CloudDesktopAPI }) {
  const { overview, operations, refresh } = useSuite(api);
  if (!overview) return null;
  return (
    <AppsScreen
      overview={overview}
      operations={operations}
      api={api}
      refresh={refresh}
    />
  );
}

function completedOperation(
  app: SuiteAppId,
  kind: OperationSnapshot["kind"],
): OperationSnapshot {
  return {
    id: `done-${app}`,
    app,
    kind,
    version: "1.0.0",
    status: "done",
    progress: { transferred: 1, total: 1, percent: 100, bytesPerSecond: null },
    error: null,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
  };
}

describe("AppsScreen", () => {
  it("shows every app's card with its derived status", async () => {
    const api = createMockApi();
    render(<Harness api={api} />);

    expect(await screen.findByText("LumaCast")).toBeInTheDocument();
    expect(
      screen.getByText("Update available 0.1.26 → 0.1.27"),
    ).toBeInTheDocument();

    expect(screen.getByText("Lumaflux")).toBeInTheDocument();
    // Chord also ships no releases and isn't installed, so 'Not installed'
    // renders on two cards (Lumaflux and LumaChord) — scope to Lumaflux's
    // own card instead of asserting on the ambiguous shared text.
    const fluxCard = screen
      .getByText("Lumaflux")
      .closest("section") as HTMLElement;
    expect(fluxCard).not.toBeNull();
    expect(within(fluxCard).getByText("Not installed")).toBeInTheDocument();
    expect(screen.getAllByText("Not installed")).toHaveLength(2);

    expect(screen.getByText("LumaCloud")).toBeInTheDocument();
    expect(screen.getByText("Installed 0.1.0")).toBeInTheDocument();
  });

  it("opens the permission dialog when an ungranted app's Install is clicked", async () => {
    const api = createMockApi();
    render(<Harness api={api} />);

    await screen.findByText("Lumaflux");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(
      await screen.findByText("Allow LumaCloud to manage Lumaflux?"),
    ).toBeInTheDocument();
    expect(screen.getByText("app.lumaflux.desktop")).toBeInTheDocument();
  });

  it("Allow grants the app and then runs the original install", async () => {
    const api = createMockApi();
    const grantSpy = vi.spyOn(api, "grant");
    const installSpy = vi.spyOn(api, "install");

    render(<Harness api={api} />);

    await screen.findByText("Lumaflux");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findByText("Allow LumaCloud to manage Lumaflux?");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      // Flush the microtask queue: `onAllow` awaits `api.grant(app)` before it
      // runs the original install action.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(grantSpy).toHaveBeenCalledWith("flux");
    expect(installSpy).toHaveBeenCalledWith("flux", undefined);
    expect(grantSpy.mock.invocationCallOrder[0]).toBeLessThan(
      installSpy.mock.invocationCallOrder[0],
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Allow LumaCloud to manage Lumaflux?"),
      ).not.toBeInTheDocument(),
    );

    // The mock advances a queued/downloading install on a real timer; cancel
    // it so nothing keeps ticking after the test (and the suite) ends.
    const operation = await installSpy.mock.results[0]!.value;
    await api.cancel(operation.id);
  });

  it("selects cards without starting operations and supports range and keyboard selection", async () => {
    const api = createMockApi();
    const installSpy = vi.spyOn(api, "install");
    const uninstallSpy = vi.spyOn(api, "uninstall");
    render(<Harness api={api} />);

    const cast = await screen.findByText("LumaCast");
    fireEvent.click(cast);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(installSpy).not.toHaveBeenCalled();
    expect(uninstallSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Lumaflux"), { shiftKey: true });
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.keyDown(cast, { key: "a", ctrlKey: true });
    expect(screen.getByText("4 selected")).toBeInTheDocument();
    fireEvent.keyDown(cast, { key: "Escape" });
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    expect(installSpy).not.toHaveBeenCalled();
    expect(uninstallSpy).not.toHaveBeenCalled();
  });

  it("does not run the primary install action on a modifier click", async () => {
    const api = createMockApi();
    const installSpy = vi.spyOn(api, "install");
    render(<Harness api={api} />);

    await screen.findByText("Lumaflux");
    fireEvent.click(screen.getByRole("button", { name: "Install" }), {
      ctrlKey: true,
    });

    expect(installSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it("keeps busy apps selected but excludes them from bulk actions", async () => {
    const api = createMockApi();
    const overview = await api.overview();
    const installSpy = vi.spyOn(api, "install");
    const busyOperation: OperationSnapshot = {
      ...completedOperation("cast", "update"),
      id: "busy-cast",
      status: "downloading",
      finishedAt: null,
      progress: { transferred: 5, total: 10, percent: 50, bytesPerSecond: 1 },
    };
    render(
      <AppsScreen
        overview={overview}
        operations={[busyOperation]}
        api={api}
        refresh={async () => {
          await api.refresh();
        }}
      />,
    );

    fireEvent.click(screen.getByText("LumaCast"));
    fireEvent.click(screen.getByText("Lumaflux"), { ctrlKey: true });

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Install or Update (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Uninstall (1)" }),
    ).not.toBeInTheDocument();
    expect(installSpy).not.toHaveBeenCalled();
  });

  it("reviews grants once before installing or updating selected apps", async () => {
    const api = createMockApi();
    const grantSpy = vi.spyOn(api, "grant");
    const installSpy = vi
      .spyOn(api, "install")
      .mockImplementation(async (app) =>
        completedOperation(app, app === "flux" ? "install" : "update"),
      );
    render(<Harness api={api} />);

    fireEvent.click(await screen.findByText("LumaCast"));
    fireEvent.click(screen.getByText("Lumaflux"), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Install or Update (2)" }),
    );

    const review = await screen.findByRole("dialog");
    expect(within(review).getByText("LumaCast")).toBeInTheDocument();
    expect(within(review).getByText("Lumaflux")).toBeInTheDocument();
    expect(within(review).getAllByText("Permission required")).toHaveLength(2);
    expect(installSpy).not.toHaveBeenCalled();
    expect(grantSpy).not.toHaveBeenCalled();

    fireEvent.click(
      within(review).getByRole("button", { name: "Allow and Continue" }),
    );

    await waitFor(() => expect(installSpy).toHaveBeenCalledTimes(2));
    expect(grantSpy).toHaveBeenNthCalledWith(1, "cast");
    expect(grantSpy).toHaveBeenNthCalledWith(2, "flux");
    expect(grantSpy.mock.invocationCallOrder[0]).toBeLessThan(
      installSpy.mock.invocationCallOrder[0],
    );
    expect(grantSpy.mock.invocationCallOrder[1]).toBeLessThan(
      installSpy.mock.invocationCallOrder[1],
    );
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  }, 10000);

  it("opens one uninstall review for Delete, excludes Cloud, and preserves user data by default", async () => {
    const api = createMockApi();
    const grantSpy = vi.spyOn(api, "grant");
    const uninstallSpy = vi
      .spyOn(api, "uninstall")
      .mockImplementation(async (app) => completedOperation(app, "uninstall"));
    render(<Harness api={api} />);

    const cast = await screen.findByText("LumaCast");
    fireEvent.keyDown(cast, { key: "Delete" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(cast);
    fireEvent.click(screen.getByRole("button", { name: "Select LumaCloud" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.keyDown(cast, { key: "Delete" });

    const review = await screen.findByRole("dialog");
    expect(within(review).getByText("LumaCast")).toBeInTheDocument();
    expect(within(review).queryByText("LumaCloud")).not.toBeInTheDocument();
    expect(
      within(review).getByRole("checkbox", {
        name: "Also delete user data from these apps",
      }),
    ).not.toBeChecked();
    expect(grantSpy).not.toHaveBeenCalled();
    expect(uninstallSpy).not.toHaveBeenCalled();

    fireEvent.click(
      within(review).getByRole("button", { name: "Allow and Remove" }),
    );

    await waitFor(() => expect(uninstallSpy).toHaveBeenCalledOnce());
    expect(grantSpy).toHaveBeenCalledWith("cast");
    expect(uninstallSpy).toHaveBeenCalledWith("cast", {
      removeUserData: false,
    });
  });

  it("stops after the first bulk failure and keeps failed and pending apps selected", async () => {
    const api = createMockApi();
    await api.grant("cast");
    await api.grant("flux");
    const listeners = new Set<(operation: OperationSnapshot) => void>();
    let currentOperation: OperationSnapshot | null = null;
    vi.spyOn(api, "operations").mockImplementation(async () =>
      currentOperation ? [currentOperation] : [],
    );
    vi.spyOn(api, "onOperation").mockImplementation((callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    });
    const installSpy = vi
      .spyOn(api, "install")
      .mockImplementation(async (app) => {
        const queued: OperationSnapshot = {
          ...completedOperation(app, app === "cast" ? "update" : "install"),
          id: `queued-${app}`,
          status: "queued",
          error: null,
          finishedAt: null,
        };
        currentOperation = queued;
        setTimeout(() => {
          const failed: OperationSnapshot = {
            ...queued,
            status: "failed",
            error: "disk full",
            finishedAt: new Date().toISOString(),
          };
          currentOperation = failed;
          listeners.forEach((listener) => listener(failed));
        }, 0);
        return queued;
      });
    render(<Harness api={api} />);

    fireEvent.click(await screen.findByText("LumaCast"));
    fireEvent.click(screen.getByText("Lumaflux"), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Install or Update (2)" }),
    );

    expect(
      await screen.findByText("Stopped at LumaCast. disk full"),
    ).toBeInTheDocument();
    expect(installSpy).toHaveBeenCalledOnce();
    expect(installSpy).toHaveBeenCalledWith("cast");
    expect(installSpy).not.toHaveBeenCalledWith("flux");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("drops a completed app from selection when a later bulk action fails", async () => {
    const api = createMockApi();
    await api.grant("cast");
    await api.grant("flux");
    const installSpy = vi
      .spyOn(api, "install")
      .mockImplementation(async (app) => {
        if (app === "cast") return completedOperation(app, "update");
        throw new Error("release unavailable");
      });
    render(<Harness api={api} />);

    fireEvent.click(await screen.findByText("LumaCast"));
    fireEvent.click(screen.getByText("Lumaflux"), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Install or Update (2)" }),
    );

    expect(
      await screen.findByText("Stopped at Lumaflux. release unavailable"),
    ).toBeInTheDocument();
    expect(installSpy).toHaveBeenCalledTimes(2);
    expect(installSpy).toHaveBeenNthCalledWith(1, "cast");
    expect(installSpy).toHaveBeenNthCalledWith(2, "flux");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select LumaCast" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Deselect Lumaflux" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
