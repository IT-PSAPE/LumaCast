import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { neutralRecipe, type Photo } from "@lumacast/photo-model";
import { Adjustments } from "../../../../apps/flux/renderer/Adjustments";

afterEach(cleanup);

type AdjustmentProps = ComponentProps<typeof Adjustments>;

function photo(): Photo {
  return {
    id: "photo-1",
    path: "/photos/studio.jpg",
    name: "studio.jpg",
    folder: "/photos",
    width: 6000,
    height: 4000,
    format: "jpeg",
    size: 4_200_000,
    importedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    metadata: { Camera: "Studio camera" },
    recipe: neutralRecipe(),
    revision: 7,
    rating: 0,
    favorite: false,
    history: [],
    future: [],
  };
}

function renderInspector(overrides: Partial<AdjustmentProps> = {}) {
  const selectedPhoto = photo();
  const props: AdjustmentProps = {
    histogramData: null,
    pixelSample: null,
    clipping: { shadows: false, highlights: false },
    onClipping: vi.fn(),
    onClipHover: vi.fn(),
    photo: selectedPhoto,
    recipe: selectedPhoto.recipe,
    onDraft: vi.fn(),
    onCommit: vi.fn(),
    onAction: vi.fn(),
    copied: true,
    busy: false,
    tab: "Adjustments",
    onTab: vi.fn(),
    aspect: "free",
    onAspect: vi.fn(),
    locked: false,
    onLocked: vi.fn(),
    ...overrides,
  };

  function Inspector() {
    const [tab, setTab] = useState(props.tab);
    return (
      <Adjustments
        {...props}
        tab={tab}
        onTab={(next) => {
          props.onTab(next);
          setTab(next);
        }}
      />
    );
  }

  render(<Inspector />);
  return props;
}

function chooseTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
  return screen.getByRole("tabpanel", { name });
}

describe("photo inspector tools", () => {
  it("associates each tab with its own tools and unmounts inactive controls", () => {
    const { onTab, onAction } = renderInspector();
    const adjustments = screen.getByRole("tabpanel", { name: "Adjustments" });
    expect(within(adjustments).getByRole("slider", { name: "Exposure" })).toBeTruthy();
    expect(within(adjustments).getByRole("slider", { name: "Temperature" })).toBeTruthy();
    expect(within(adjustments).queryByRole("button", { name: "Rotate left" })).toBeNull();

    const composition = chooseTab("Composition");
    expect(screen.getByRole("tab", { name: "Composition" })).toHaveAttribute("aria-controls", composition.id);
    expect(within(composition).getByRole("slider", { name: "Straighten" })).toBeTruthy();
    expect(within(composition).getByRole("slider", { name: "Distortion" })).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Exposure", hidden: true })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Temperature", hidden: true })).toBeNull();

    const info = chooseTab("Info");
    expect(within(info).getByText("studio.jpg")).toBeTruthy();
    expect(within(info).getByText("6000 × 4000")).toBeTruthy();
    expect(within(info).getByText("Studio camera")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Straighten", hidden: true })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Distortion", hidden: true })).toBeNull();
    fireEvent.click(within(info).getByRole("button", { name: "Relink original file" }));
    expect(onAction).toHaveBeenCalledWith("relink");
    expect(onTab).toHaveBeenNthCalledWith(1, "Composition");
    expect(onTab).toHaveBeenNthCalledWith(2, "Info");
  });

  it("restores the established disclosure defaults when revisiting a tab", () => {
    renderInspector();
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Color" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("slider", { name: "Sharpening" })).toBeTruthy();

    const composition = chooseTab("Composition");
    expect(
      within(composition).getByRole("button", { name: "Composition" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(composition).getByRole("button", { name: "Lens correction" }),
    ).toHaveAttribute("aria-expanded", "true");
    chooseTab("Adjustments");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Color" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves photo ownership for keyboard adjustment commits and direct resets", () => {
    const { onDraft, onCommit } = renderInspector();
    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.keyDown(exposure, { key: "ArrowRight" });
    fireEvent.keyUp(exposure, { key: "ArrowRight" });
    expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({ exposure: 0.05 }), "photo-1", 7);
    expect(onCommit).toHaveBeenCalledWith({ exposure: 0.05 }, 7, "photo-1");
    fireEvent.click(screen.getByTitle("Reset Exposure"));
    expect(onCommit).toHaveBeenLastCalledWith({ exposure: 0 });

    chooseTab("Composition");
    fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
    expect(onCommit).toHaveBeenLastCalledWith({ rotation: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Flip horizontal" }));
    expect(onCommit).toHaveBeenLastCalledWith({ flipX: true });
  });

  it("keeps copy, paste and apply actions available across all tool tabs", () => {
    const { onAction } = renderInspector();
    for (const tab of ["Adjustments", "Composition", "Info"]) {
      chooseTab(tab);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      fireEvent.click(screen.getByRole("button", { name: "Paste" }));
      fireEvent.click(screen.getByRole("button", { name: "Apply to selected" }));
    }
    expect(onAction).toHaveBeenCalledTimes(9);
    expect(onAction).toHaveBeenNthCalledWith(1, "copy");
    expect(onAction).toHaveBeenNthCalledWith(2, "paste");
    expect(onAction).toHaveBeenNthCalledWith(3, "sync");
    expect(onAction).toHaveBeenNthCalledWith(7, "copy");
    expect(onAction).toHaveBeenNthCalledWith(8, "paste");
    expect(onAction).toHaveBeenNthCalledWith(9, "sync");
  });

  it("keeps copying available while busy and disables editing and paste", () => {
    renderInspector({ busy: true });
    expect(screen.getByRole("button", { name: "Auto light" })).toBeDisabled();
    expect(screen.getByTitle("Reset Exposure")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply to selected" })).toBeDisabled();
    chooseTab("Composition");
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Auto lens correction" })).toBeDisabled();
  });

  it("shows the selection prompt on every tab without enabling photo actions", () => {
    renderInspector({ photo: undefined, recipe: undefined });
    for (const tab of ["Adjustments", "Composition", "Info"]) {
      const panel = chooseTab(tab);
      expect(within(panel).getByText("Select a photo to adjust light, color, and composition.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Apply to selected" })).toBeDisabled();
    }
    expect(screen.queryByRole("button", { name: "File information" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Relink original file" })).toBeNull();
  });
});
