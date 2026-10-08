#ifdef NDEBUG
#undef NDEBUG
#endif
#include "gpu-pixel-copy.h"

#include <array>
#include <cassert>
#include <cstdint>
#include <stdexcept>

int main() {
  // Source rows have padding, as D3D11 readback RowPitch commonly does.
  const std::array<uint8_t, 24> paddedSource{
      10, 20, 30, 40, 50, 60, 70, 80, 0xEE, 0xEE, 0xEE, 0xEE,
      90, 100, 110, 120, 130, 140, 150, 160, 0xDD, 0xDD, 0xDD, 0xDD,
  };

  std::array<uint8_t, 16> opaque{};
  ndi_gpu::CopyGpuPixelRows(paddedSource.data(), 12, opaque.data(), 2, 2, false);
  const std::array<uint8_t, 16> opaqueExpected{
      10, 20, 30, 255, 50, 60, 70, 255,
      90, 100, 110, 255, 130, 140, 150, 255,
  };
  assert(opaque == opaqueExpected);  // Opaque X bytes are normalized to 255.

  const std::array<uint8_t, 16> alphaSource{
      10, 20, 30, 40, 50, 60, 70, 80,
      0, 1, 2, 0, 128, 64, 32, 255,
  };
  std::array<uint8_t, 16> alpha{};
  ndi_gpu::CopyGpuPixelRows(alphaSource.data(), 8, alpha.data(), 2, 2, true);
  const std::array<uint8_t, 16> alphaExpected{
      64, 128, 191, 40, 159, 191, 223, 80,
      0, 0, 0, 0, 128, 64, 32, 255,
  };
  assert(alpha == alphaExpected);  // Straight-alpha conversion and alpha bytes remain intact.

  // Both pixel layouts use the same three colour bytes. A one-byte offset
  // checks the packed opaque copy without relying on pointer alignment.
  const std::array<uint8_t, 5> unalignedSource{0xEE, 15, 25, 35, 45};
  std::array<uint8_t, 6> unalignedDestination{0xAA, 0, 0, 0, 0, 0xBB};
  ndi_gpu::CopyGpuPixelRows(unalignedSource.data() + 1, 4,
                          unalignedDestination.data() + 1, 1, 1, false);
  const std::array<uint8_t, 6> unalignedExpected{0xAA, 15, 25, 35, 255, 0xBB};
  assert(unalignedDestination == unalignedExpected);

  const std::array<uint8_t, 4> clampedSource{255, 128, 1, 1};
  std::array<uint8_t, 4> clamped{};
  ndi_gpu::CopyGpuPixelRows(clampedSource.data(), 4, clamped.data(), 1, 1, true);
  const std::array<uint8_t, 4> clampedExpected{255, 255, 255, 1};
  assert(clamped == clampedExpected);

  bool rejected = false;
  try {
    ndi_gpu::CopyGpuPixelRows(paddedSource.data(), 7, opaque.data(), 2, 2, false);
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  assert(rejected);
  for (const auto width : {0, -1}) {
    rejected = false;
    try { ndi_gpu::CopyGpuPixelRows(paddedSource.data(), 12, opaque.data(), width, 2, false); }
    catch (const std::invalid_argument&) { rejected = true; }
    assert(rejected);
  }
  rejected = false;
  try { ndi_gpu::CopyGpuPixelRows(nullptr, 12, opaque.data(), 2, 2, false); }
  catch (const std::invalid_argument&) { rejected = true; }
  assert(rejected);
  return 0;
}
