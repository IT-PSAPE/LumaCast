#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>

namespace ndi_gpu {

// Copy BGRA/RGBA rows from a possibly padded GPU readback. Opaque BGRX/RGBX
// formats require the fourth byte to be 255. Alpha sends must restore straight
// color channels for NDI.
inline void CopyGpuPixelRows(const uint8_t* source, size_t sourceStride,
                             uint8_t* destination, int32_t width, int32_t height,
                             bool preserveAlpha) {
  if (!source || !destination || width <= 0 || height <= 0
      || sourceStride < static_cast<size_t>(width) * 4) {
    throw std::invalid_argument("Invalid GPU pixel row layout");
  }

  const size_t rowBytes = static_cast<size_t>(width) * 4;
  const uint8_t opaqueAlphaBytes[4] = {0, 0, 0, 255};
  uint32_t opaqueAlphaMask = 0;
  std::memcpy(&opaqueAlphaMask, opaqueAlphaBytes, sizeof(opaqueAlphaMask));
  for (int32_t y = 0; y < height; ++y) {
    const auto* sourceRow = source + static_cast<size_t>(y) * sourceStride;
    auto* destinationRow = destination + static_cast<size_t>(y) * rowBytes;
    if (!preserveAlpha) {
      // Use memcpy for unaligned-safe 32-bit loads/stores; OR makes only the
      // fourth byte 255 on both little- and big-endian hosts. Keeping this
      // separate from the alpha branch allows the compiler to vectorize it.
      for (int32_t x = 0; x < width; ++x) {
        uint32_t pixel = 0;
        std::memcpy(&pixel, sourceRow + static_cast<size_t>(x) * 4, sizeof(pixel));
        pixel |= opaqueAlphaMask;
        std::memcpy(destinationRow + static_cast<size_t>(x) * 4, &pixel, sizeof(pixel));
      }
      continue;
    }

    std::memcpy(destinationRow, sourceRow, rowBytes);

    for (int32_t x = 0; x < width; ++x) {
      const unsigned alpha = destinationRow[x * 4 + 3];
      if (alpha == 255) continue;
      for (int color = 0; color < 3; ++color) {
        destinationRow[x * 4 + color] = alpha
            ? static_cast<uint8_t>(std::min(255U,
                (unsigned(destinationRow[x * 4 + color]) * 255U + alpha / 2U) / alpha))
            : 0;
      }
    }
  }
}

}  // namespace ndi_gpu
