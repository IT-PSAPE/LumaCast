export interface PreviewSize {
  width: number;
  height: number;
}

export function fitPreviewSize(
  availableWidth: number,
  availableHeight: number,
  outputWidth: number,
  outputHeight: number,
): PreviewSize {
  if (![availableWidth, availableHeight, outputWidth, outputHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return { width: 0, height: 0 };
  }

  const outputAspectRatio = outputWidth / outputHeight;
  const width = Math.min(availableWidth, availableHeight * outputAspectRatio);
  return { width, height: width / outputAspectRatio };
}
