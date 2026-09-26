import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
