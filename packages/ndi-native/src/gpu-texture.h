#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace ndi_gpu {

struct Plane {
  int fd = -1;
  uint32_t stride = 0;
  uint32_t offset = 0;
  uint64_t size = 0;
};
struct Handle {
  uint32_t surfaceId = 0;
  uintptr_t dxgiHandle = 0;
  int targetPid = 0;
  std::string token;
  std::vector<Plane> planes;
  uint64_t modifier = 0;
};

struct Pixels {
  uint8_t* data;
  size_t size;
  int32_t stride;
  uint32_t fourCC;
};

class Surface {
 public:
  virtual ~Surface() = default;
};

class Converter {
 public:
  virtual ~Converter() = default;
  // Two alternating native buffers remain alive until the next NDI send
  // synchronizes ownership. No pixel buffer is returned to JavaScript.
  virtual Pixels Convert(Surface& surface, int slot) = 0;
};

bool Supported();
std::string ReceiverEndpoint();
Handle Export(const uint8_t* handle, size_t length, int targetPid,
              const std::string& endpoint, const std::vector<Plane>& planes, uint64_t modifier);
void Discard(const Handle& handle);
// This pointer is trusted Electron main-process data, never renderer input.
uint32_t SurfaceId(const uint8_t* handle, size_t length);
std::unique_ptr<Surface> Lookup(uint32_t id, int32_t width, int32_t height,
                                const std::string& pixelFormat);
std::unique_ptr<Surface> Lookup(const Handle& handle, int32_t width, int32_t height,
                              const std::string& pixelFormat);
std::unique_ptr<Converter> CreateConverter(int32_t width, int32_t height,
                                         bool withAlpha);

}  // namespace ndi_gpu
