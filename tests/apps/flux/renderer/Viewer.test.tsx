import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { neutralRecipe, type Photo, type Recipe } from "@lumacast/photo-model";
import { Viewer } from "../../../../apps/flux/renderer/Viewer";

afterEach(cleanup);

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
    revision: 0,
    history: [],
    future: [],
  };
}

function renderViewer(
  currentPhoto: Photo,
  preview: (id: string, recipe: ReturnType<typeof neutralRecipe>, max?: number) => Promise<string>,
  onAction = vi.fn(),
  recipe: Recipe = currentPhoto.recipe,
) {
  return render(
    <Viewer
      photo={currentPhoto}
      recipe={recipe}
      preview={preview}
      onCrop={vi.fn()}
      onError={vi.fn()}
      onHistogram={vi.fn()}
      onSample={vi.fn()}
      clipping={{ shadows: false, highlights: false }}
      composition={false}
      aspect="free"
      locked={false}
      previous={vi.fn()}
      next={vi.fn()}
      canPrevious={false}
      canNext={false}
      busy={false}
      onAction={onAction}
    />,
  );
}

describe("Flux photo preview", () => {
  it("shows an inline error and retries a failed preview", async () => {
    const preview = vi
      .fn<(id: string, recipe: ReturnType<typeof neutralRecipe>, max?: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce("data:image/jpeg;base64,ok");
    renderViewer(photo("first"), preview);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));

    expect(await screen.findByRole("img", { name: "first.jpg" })).toBeTruthy();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  });

  it("does not show the previous photo while the next preview is pending", async () => {
    let resolveSecond!: (value: string) => void;
    const secondPreview = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    const preview = vi
      .fn<(id: string, recipe: ReturnType<typeof neutralRecipe>, max?: number) => Promise<string>>()
      .mockResolvedValueOnce("data:image/jpeg;base64,first")
      .mockReturnValueOnce(secondPreview);
    const view = renderViewer(photo("first"), preview);
    expect(await screen.findByRole("img", { name: "first.jpg" })).toBeTruthy();

    view.rerender(
      <Viewer
        photo={photo("second")}
        recipe={photo("second").recipe}
        preview={preview}
        onCrop={vi.fn()}
        onError={vi.fn()}
        onHistogram={vi.fn()}
        onSample={vi.fn()}
        clipping={{ shadows: false, highlights: false }}
        composition={false}
        aspect="free"
        locked={false}
        previous={vi.fn()}
        next={vi.fn()}
        canPrevious={false}
        canNext={false}
        busy={false}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole("img", { name: "first.jpg" })).toBeNull();
    expect(screen.getByText("Rendering preview…")).toBeTruthy();
    resolveSecond("data:image/jpeg;base64,second");
    expect(await screen.findByRole("img", { name: "second.jpg" })).toBeTruthy();
  });

  it("loads a fresh original preview when Compare is opened again", async () => {
    const editedRecipe = { ...neutralRecipe(), exposure: 1 };
    const currentPhoto = { ...photo("first"), recipe: editedRecipe };
    const preview = vi.fn(async (_id: string, _recipe: Recipe) => "data:image/jpeg;base64,frame");
    renderViewer(currentPhoto, preview, vi.fn(), editedRecipe);

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    const compare = screen.getByRole("button", { name: "Compare" });
    fireEvent.click(compare);
    await screen.findByRole("img", { name: "Original first.jpg" });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));

    fireEvent.click(compare);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(4));
    fireEvent.click(compare);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(6));

    const neutralCalls = preview.mock.calls.filter(([, recipe]) =>
      JSON.stringify(recipe) === JSON.stringify(neutralRecipe()),
    );
    expect(neutralCalls).toHaveLength(2);
  });

  it("offers Relink when preview fails even if the catalog still says the file exists", async () => {
    const currentPhoto = { ...photo("first"), missing: false };
    const onAction = vi.fn();
    const preview = vi
      .fn<(id: string, recipe: Recipe, max?: number) => Promise<string>>()
      .mockRejectedValue(new Error("ENOENT: source disappeared"));
    renderViewer(currentPhoto, preview, onAction);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Relink original" }));
    expect(onAction).toHaveBeenCalledWith("relink");
  });
});
