export const rawExtensions = [
  "3fr",
  "arw",
  "cr2",
  "cr3",
  "crw",
  "dcr",
  "dng",
  "erf",
  "fff",
  "iiq",
  "kdc",
  "mef",
  "mos",
  "mrw",
  "nef",
  "nrw",
  "orf",
  "pef",
  "raf",
  "raw",
  "rw2",
  "rwl",
  "sr2",
  "srf",
  "srw",
  "x3f",
];
export const imageExtensions = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "tif",
  "tiff",
  ...rawExtensions,
];
export const importFormats = ["jpeg", "png", "webp", "tiff", ...rawExtensions];
export function isRawFile(file: string) {
  return rawExtensions.includes(file.split(".").pop()!.toLowerCase());
}
