export type AssetPhotoIdentity = {
  id: string;
  revision: number;
  path: string;
};

export type SourceFileStamp = {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export function assetCacheKey(
  photo: AssetPhotoIdentity,
  stamp: SourceFileStamp,
) {
  return `${photo.id}:${photo.revision}:${photo.path}:${stamp.size}:${stamp.mtimeMs}:${stamp.ctimeMs}`;
}
