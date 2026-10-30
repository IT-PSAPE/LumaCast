import { describe, expect, it } from "vitest";
import { neutralRecipe, type Photo, type Recipe } from "@lumacast/photo-model";
import { recipeForPhoto } from "../../../../apps/flux/renderer/photo-draft";

function photo(id: string, revision = 0): Photo {
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
    revision,
    history: [],
    future: [],
  };
}

describe("photo-bound edit drafts", () => {
  it("shows a draft only for its photo and base revision", () => {
    const first = photo("first", 3);
    const second = photo("second", 3);
    const draftRecipe: Recipe = { ...first.recipe, exposure: 1.25 };
    const draft = { photoId: first.id, revision: first.revision, recipe: draftRecipe };
    const newerRevision = photo("first", 4);

    expect(recipeForPhoto(first, draft)).toBe(draftRecipe);
    expect(recipeForPhoto(second, draft)).toBe(second.recipe);
    expect(recipeForPhoto(newerRevision, draft)).toBe(newerRevision.recipe);
    expect(recipeForPhoto(undefined, draft)).toBeUndefined();
  });
});
