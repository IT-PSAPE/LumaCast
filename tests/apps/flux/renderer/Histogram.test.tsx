import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { neutralRecipe, type Photo } from "@lumacast/photo-model";
import { Histogram } from "../../../../apps/flux/renderer/Histogram";
import { histogram } from "../../../../apps/flux/renderer/histogram-data";

afterEach(cleanup);

function renderHistogram(data: ReturnType<typeof histogram> | null) {
  const onClipping = vi.fn();
  render(
    <Histogram
      data={data}
      sample={null}
      busy={false}
      onDraft={vi.fn()}
      onCommit={vi.fn()}
      clipping={{ shadows: false, highlights: false }}
      onClipping={onClipping}
      onHover={vi.fn()}
    />,
  );
  return onClipping;
}

it("uses themed ink for indicators without channel clipping", () => {
  renderHistogram(null);
  for (const label of ["Shadow clipping", "Highlight clipping"]) {
    const toggle = screen.getByRole("button", { name: label });
    expect(toggle.style.color).toBe("var(--text-color-tertiary)");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
});

it("retains channel-specific clipping colours and toggles", () => {
  // Red clips high, blue clips low: those colours convey actual image data.
  const onClipping = renderHistogram(
    histogram(new Uint8ClampedArray([255, 80, 0, 255])),
  );
  const shadow = screen.getByRole("button", { name: "Shadow clipping" });
  const highlight = screen.getByRole("button", { name: "Highlight clipping" });
  expect(shadow.style.color).toBe("rgb(0, 0, 210)");
  expect(highlight.style.color).toBe("rgb(210, 0, 0)");
  fireEvent.click(shadow);
  expect(onClipping).toHaveBeenCalledWith("shadows");
  fireEvent.click(highlight);
  expect(onClipping).toHaveBeenCalledWith("highlights");
});

it("keeps the active histogram zone focused while work blocks conflicting edits", () => {
  const photo: Photo = {
    id: "photo-1",
    path: "/photos/a.jpg",
    name: "a.jpg",
    folder: "/photos",
    width: 24,
    height: 16,
    format: "jpeg",
    size: 100,
    importedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    rating: 0,
    favorite: false,
    recipe: neutralRecipe(),
    revision: 4,
    history: [],
    future: [],
  };
  const onCommit = vi.fn();
  const onDraft = vi.fn();
  const props = {
    data: histogram(new Uint8ClampedArray([100, 100, 100, 255])),
    sample: null,
    photo,
    recipe: photo.recipe,
    busy: false,
    onDraft,
    onCommit,
    clipping: { shadows: false, highlights: false },
    onClipping: vi.fn(),
    onHover: vi.fn(),
  };
  const view = render(<Histogram {...props} />);
  const exposure = screen.getByRole("slider", { name: "Histogram Exposure" });
  act(() => exposure.focus());
  fireEvent.keyDown(exposure, { key: "ArrowRight" });
  expect(onCommit).toHaveBeenCalledWith({ exposure: 0.05 }, 4, "photo-1");

  view.rerender(<Histogram {...props} busy />);
  expect(exposure).toHaveFocus();
  expect(exposure).not.toBeDisabled();
  expect(exposure).toHaveAttribute("aria-disabled", "true");
  fireEvent.keyDown(exposure, { key: "ArrowRight" });
  fireEvent.doubleClick(exposure);
  fireEvent.pointerDown(exposure, { button: 0, pointerId: 1, clientX: 10 });
  fireEvent.pointerMove(exposure, { pointerId: 1, clientX: 30 });
  fireEvent.pointerUp(exposure, { pointerId: 1, clientX: 30 });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onDraft).not.toHaveBeenCalled();

  const nextPhoto = {
    ...photo,
    recipe: { ...photo.recipe, exposure: 0.05 },
    revision: 5,
  };
  view.rerender(<Histogram {...props} photo={nextPhoto} recipe={nextPhoto.recipe} />);
  fireEvent.keyDown(exposure, { key: "ArrowRight" });
  expect(onCommit).toHaveBeenLastCalledWith({ exposure: 0.1 }, 5, "photo-1");
  expect(exposure).toHaveFocus();

  view.rerender(<Histogram {...props} data={null} />);
  expect(exposure).toBeDisabled();
});
