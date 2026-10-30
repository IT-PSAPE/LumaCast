import type { Photo, Recipe } from "@lumacast/photo-model";

export type PhotoDraft = {
  photoId: string;
  revision: number;
  recipe: Recipe;
};

/** Apply an in-progress recipe only to the photo revision that owns it. */
export function recipeForPhoto(
  photo: Photo | undefined,
  draft: PhotoDraft | null,
): Recipe | undefined {
  if (!photo) return undefined;
  return draft?.photoId === photo.id && draft.revision === photo.revision
    ? draft.recipe
    : photo.recipe;
}
