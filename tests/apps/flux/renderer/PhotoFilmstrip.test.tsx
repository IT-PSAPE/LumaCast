import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { neutralRecipe, type Photo } from "@lumacast/photo-model";
import { PhotoFilmstrip } from "../../../../apps/flux/renderer/PhotoFilmstrip";

afterEach(cleanup);

function makePhoto(id: string, revision = 0): Photo {
  return {
    id,
    path: `/photos/${id}.jpg`,
    name: `${id}.jpg`,
    folder: "/photos",
    width: 32,
    height: 24,
    format: "jpeg",
    size: 100,
    metadata: {},
    importedAt: "2026-10-01T00:00:00.000Z",
    modifiedAt: "2026-10-01T00:00:00.000Z",
    rating: 0,
    favorite: false,
    missing: false,
    recipe: neutralRecipe(),
    revision,
    history: [],
    future: [],
  };
}

describe("PhotoFilmstrip", () => {
  it("skips unchanged thumbnails on unrelated updates and refreshes only changed rows", () => {
    const photos = Array.from({ length: 1000 }, (_, index) => makePhoto(`photo-${index}`));
    const selected = new Set(["photo-1"]);
    const onSelect = vi.fn();
    const onKeyDown = vi.fn();
    const assetUrl = vi.fn((id: string, revision: number) => `lumaflux://asset/${id}?revision=${revision}`);

    function Harness({
      sample,
      photos: currentPhotos = photos,
      activeId = "photo-0",
    }: {
      sample: string;
      photos?: Photo[];
      activeId?: string;
    }) {
      return (
        <>
          <output>{sample}</output>
          <PhotoFilmstrip
            photos={currentPhotos}
            selected={selected}
            activeId={activeId}
            onSelect={onSelect}
            assetUrl={assetUrl}
            onKeyDown={onKeyDown}
          />
        </>
      );
    }

    const view = render(<Harness sample="initial" />);
    const firstButton = view.container.querySelector<HTMLButtonElement>('[data-photo-id="photo-0"]')!;
    const lastImage = view.container.querySelector<HTMLImageElement>('[data-photo-id="photo-999"] img')!;
    expect(assetUrl).toHaveBeenCalledTimes(1000);
    expect(firstButton.className).toBe("active");
    expect(view.container.querySelector('[data-photo-id="photo-1"]')).toHaveAttribute("aria-pressed", "true");

    view.rerender(<Harness sample="new histogram sample" />);
    expect(view.container.querySelector('[data-photo-id="photo-0"]')).toBe(firstButton);
    expect(assetUrl).toHaveBeenCalledTimes(1000);

    view.rerender(<Harness sample="active photo changed" activeId="photo-1" />);
    expect(assetUrl).toHaveBeenCalledTimes(1002);
    expect(view.container.querySelector('[data-photo-id="photo-0"]')?.className).toBe("");
    expect(view.container.querySelector('[data-photo-id="photo-1"]')?.className).toBe("active selected");

    const revisedPhotos = [...photos];
    revisedPhotos[999] = { ...photos[999], revision: 1 };
    view.rerender(<Harness sample="revision changed" activeId="photo-1" photos={revisedPhotos} />);
    expect(assetUrl).toHaveBeenCalledTimes(1003);
    expect(view.container.querySelector('[data-photo-id="photo-999"] img')).toBe(lastImage);
    expect(lastImage.src).toBe("lumaflux://asset/photo-999?revision=1");
  });

  it("preserves photo selection and collection keyboard events", () => {
    const onSelect = vi.fn();
    const onKeyDown = vi.fn();
    const view = render(
      <PhotoFilmstrip
        photos={[makePhoto("one")]}
        selected={new Set()}
        activeId="one"
        onSelect={onSelect}
        assetUrl={(id, revision) => `${id}:${revision}`}
        onKeyDown={onKeyDown}
      />,
    );
    const button = view.getByTitle("one.jpg");

    fireEvent.click(button, { shiftKey: true });
    fireEvent.keyDown(button, { key: "ArrowRight" });

    expect(onSelect).toHaveBeenCalledWith("one", expect.objectContaining({ shiftKey: true }));
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "ArrowRight" }));
  });
});
