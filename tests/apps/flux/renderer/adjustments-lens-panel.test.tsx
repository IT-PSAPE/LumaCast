import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { neutralRecipe, type Photo, type Recipe } from "@lumacast/photo-model";
import { Adjustments } from "../../../../apps/flux/renderer/Adjustments";

afterEach(cleanup);

const lensProfile = {
  id: "nikon-50mm",
  name: "Nikkor 50mm f/1.8",
  source: "Lensfun" as const,
  revision: "1",
  cameraCrop: 1,
  calibrationCrop: 1.5,
  aspect: 1.5,
  focal: 50.26666667,
  distortion: null,
  tca: null,
  vignette: null,
};

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "p1",
    path: "/photos/a.jpg",
    name: "a.jpg",
    folder: "/photos",
    importedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    rating: 0,
    favorite: false,
    width: 6000,
    height: 4000,
    format: "jpeg",
    size: 4_200_000,
    recipe: neutralRecipe(),
    revision: 7,
    history: [],
    future: [],
    ...overrides,
  };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return { ...neutralRecipe(), ...overrides };
}

function renderInspector(
  options: {
    tab?: string;
    photo?: Photo;
    recipe?: Recipe;
    busy?: boolean;
    onCommit?: (patch: Partial<Recipe>, revision?: number) => void;
    onAction?: (name: string) => void;
  } = {},
) {
  const onCommit = options.onCommit ?? vi.fn();
  const onAction = options.onAction ?? vi.fn();
  const utils = render(
    <Adjustments
      histogramData={null}
      pixelSample={null}
      clipping={{ shadows: false, highlights: false }}
      onClipping={vi.fn()}
      onClipHover={vi.fn()}
      photo={options.photo ?? photo()}
      recipe={options.recipe ?? recipe()}
      onDraft={vi.fn()}
      onCommit={onCommit}
      onAction={onAction}
      copied={false}
      busy={options.busy ?? false}
      tab={options.tab ?? "Composition"}
      onTab={vi.fn()}
      aspect="free"
      onAspect={vi.fn()}
      locked={false}
      onLocked={vi.fn()}
    />,
  );
  return { ...utils, onCommit, onAction };
}

function lensPanel() {
  return screen.getByRole("group", { name: /lens correction/i });
}

describe("Adjustments lens correction panel", () => {
  it("reports the matched profile as metadata rows a screen reader can read", () => {
    renderInspector({ recipe: recipe({ lensProfile }) });
    const panel = lensPanel();
    expect(within(panel).getByText("Profile")).toBeTruthy();
    expect(within(panel).getByText("Nikkor 50mm f/1.8")).toBeTruthy();
    expect(within(panel).getByText("Focal length")).toBeTruthy();
    expect(within(panel).getByText("50.3 mm")).toBeTruthy();
    expect(within(panel).getByText("Source")).toBeTruthy();
    expect(within(panel).getByText("Lensfun")).toBeTruthy();
  });

  it("shows a concise unmatched status and no remove control without a profile", () => {
    renderInspector({ recipe: recipe({ lensProfile: null }) });
    const panel = lensPanel();
    expect(within(panel).getByText(/no matched profile/i)).toBeTruthy();
    expect(within(panel).queryByText("Profile")).toBeNull();
    expect(within(panel).queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("removes the matched profile through an accessible control", () => {
    const { onCommit } = renderInspector({ recipe: recipe({ lensProfile }) });
    const remove = within(lensPanel()).getByRole("button", {
      name: "Remove profile",
    });
    fireEvent.click(remove);
    expect(onCommit).toHaveBeenCalledWith({ lensProfile: null });
  });

  it("disables removing the profile while busy, like the other mutation controls", () => {
    renderInspector({ busy: true, recipe: recipe({ lensProfile }) });
    expect(
      within(lensPanel()).getByRole("button", { name: "Remove profile" }),
    ).toBeDisabled();
  });

  it("auto lens correction keeps its label, tooltip, and single action", () => {
    const { onAction } = renderInspector({ recipe: recipe({ lensProfile }) });
    const auto = within(lensPanel()).getByRole("button", {
      name: "Auto lens correction",
    });
    expect(auto.getAttribute("title")).toBeTruthy();
    fireEvent.click(auto);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("auto_lens_correction");
  });

  it("auto does not toggle the disclosure it sits in", () => {
    const { onAction } = renderInspector({ recipe: recipe({ lensProfile }) });
    const panel = lensPanel() as HTMLDetailsElement;
    expect(panel.open).toBe(true);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Auto lens correction" }),
    );
    expect(onAction).toHaveBeenCalledWith("auto_lens_correction");
    expect(panel.open).toBe(true);
  });

  it("disables auto lens correction while busy or when the file is missing", () => {
    renderInspector({ busy: true, recipe: recipe({ lensProfile }) });
    expect(
      within(lensPanel()).getByRole("button", { name: "Auto lens correction" }),
    ).toBeDisabled();
    cleanup();
    renderInspector({
      photo: photo({ missing: true }),
      recipe: recipe({ lensProfile }),
    });
    expect(
      within(lensPanel()).getByRole("button", { name: "Auto lens correction" }),
    ).toBeDisabled();
  });

  it("only renders the lens panel on the composition tab", () => {
    renderInspector({ tab: "Adjustments", recipe: recipe({ lensProfile }) });
    expect(
      screen.queryByRole("group", { name: /lens correction/i }),
    ).toBeNull();
    cleanup();
    renderInspector({ tab: "Composition", recipe: recipe({ lensProfile }) });
    expect(lensPanel()).toBeTruthy();
  });

  it("keeps the light group auto affordance on the adjustments tab", () => {
    const { onAction } = renderInspector({ tab: "Adjustments" });
    const light = screen.getByRole("group", { name: /light/i });
    fireEvent.click(within(light).getByRole("button", { name: "Auto light" }));
    expect(onAction).toHaveBeenCalledWith("auto_adjust");
  });
});
