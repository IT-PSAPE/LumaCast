import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { neutralRecipe, type Photo } from "@lumacast/photo-model";
import { Adjustments } from "../../../../apps/flux/renderer/Adjustments";
import type { ComponentProps } from "react";

const pointerCaptureMethods = [
  "setPointerCapture",
  "hasPointerCapture",
  "releasePointerCapture",
] as const;
let restorePointerCapture = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  restorePointerCapture();
  restorePointerCapture = () => {};
});

type AdjustmentProps = ComponentProps<typeof Adjustments>;

function stubPointerCapture() {
  const before = new Map(
    pointerCaptureMethods.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  );
  for (const key of pointerCaptureMethods) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      value: key === "hasPointerCapture" ? () => true : vi.fn(),
    });
  }
  restorePointerCapture = () => {
    for (const key of pointerCaptureMethods) {
      const descriptor = before.get(key);
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, key);
    }
  };
}

function photo(id: string): Photo {
  return {
    id,
    path: `/photos/${id}.jpg`,
    name: `${id}.jpg`,
    folder: "/photos",
    width: 24,
    height: 16,
    format: "jpeg",
    size: 100,
    metadata: {},
    importedAt: "2026-10-01T00:00:00.000Z",
    modifiedAt: "2026-10-01T00:00:00.000Z",
    rating: 0,
    favorite: false,
    missing: false,
    recipe: neutralRecipe(),
    revision: 4,
    history: [],
    future: [],
  };
}

function props(
  currentPhoto: Photo,
  onDraft: AdjustmentProps["onDraft"],
  onCommit: AdjustmentProps["onCommit"],
) {
  return {
    histogramData: {
      channels: [[], [], []],
      pixels: 0,
      shadows: 0,
      highlights: 0,
      shadowChannels: 0,
      highlightChannels: 0,
    },
    pixelSample: null,
    clipping: { shadows: false, highlights: false },
    onClipping: vi.fn(),
    onClipHover: vi.fn(),
    photo: currentPhoto,
    recipe: currentPhoto.recipe,
    onDraft,
    onCommit,
    onAction: vi.fn(),
    copied: false,
    busy: false,
    tab: "Adjustments",
    onTab: vi.fn(),
    aspect: "free",
    onAspect: vi.fn(),
    locked: false,
    onLocked: vi.fn(),
  };
}

describe("photo-bound edit gestures", () => {
  it("drops an in-flight slider gesture when the active photo changes", () => {
    stubPointerCapture();
    vi.stubGlobal("PointerEvent", MouseEvent);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect);
    const onDraft = vi.fn<AdjustmentProps["onDraft"]>();
    const onCommit = vi.fn<AdjustmentProps["onCommit"]>();
    const first = photo("first");
    const second = photo("second");
    const view = render(<Adjustments {...props(first, onDraft, onCommit)} />);
    const thumb = screen.getByRole("slider", { name: "Exposure" });
    const control = thumb.parentElement?.parentElement;
    expect(control).toBeTruthy();

    fireEvent.pointerDown(control!, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: 90,
      clientY: 10,
    });
    expect(onDraft).toHaveBeenCalledWith(
      expect.objectContaining({ exposure: expect.any(Number) }),
      "first",
      4,
    );

    view.rerender(<Adjustments {...props(second, onDraft, onCommit)} />);
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 90, clientY: 10 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onDraft).toHaveBeenLastCalledWith(null, "first", 4);
    rect.mockRestore();
  });

  it("drops an in-flight histogram drag when the active photo changes", () => {
    const onDraft = vi.fn<AdjustmentProps["onDraft"]>();
    const onCommit = vi.fn<AdjustmentProps["onCommit"]>();
    const first = photo("first");
    const second = photo("second");
    stubPointerCapture();
    const view = render(<Adjustments {...props(first, onDraft, onCommit)} />);
    const slider = screen.getByRole("slider", { name: "Histogram Exposure" });
    Object.defineProperty(slider.parentElement, "clientWidth", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(slider, {
      button: 0,
      pointerId: 1,
      clientX: 10,
    });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 30 });
    expect(onDraft).toHaveBeenCalledWith(
      expect.objectContaining({ exposure: expect.any(Number) }),
      "first",
      4,
    );

    view.rerender(<Adjustments {...props(second, onDraft, onCommit)} />);
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 30 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onDraft).toHaveBeenLastCalledWith(null, "first", 4);
  });
});
