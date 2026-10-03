#include "gpu-texture.h"
#define NOMINMAX
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace ndi_gpu {
namespace {
using Microsoft::WRL::ComPtr;
void Check(HRESULT result, const char* message) {
  if (FAILED(result)) throw std::runtime_error(message);
}
struct WinSurface final : Surface {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11Texture2D> texture;
  ComPtr<IDXGIKeyedMutex> keyedMutex;
  bool bgra = false;
};

class D3DConverter final : public Converter {
 public:
  D3DConverter(int32_t width, int32_t height, bool alpha) : width_(width), height_(height), alpha_(alpha) {
    for (auto& pixels : pixels_) pixels.resize(static_cast<size_t>(width) * height * 4);
  }
  Pixels Convert(Surface& imported, int slot) override {
    auto& surface = static_cast<WinSurface&>(imported);
    if (device_.Get() != surface.device.Get()) {
      // COM wrappers may differ while referring to the same device; rebuilding
      // staging buffers is safe and only occurs when the importing device changes.
      device_ = surface.device;
      device_->GetImmediateContext(&context_);
      for (auto& staging : staging_) {
        staging.Reset();
        D3D11_TEXTURE2D_DESC desc{};
        surface.texture->GetDesc(&desc);
        desc.Usage = D3D11_USAGE_STAGING;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        desc.MiscFlags = 0;
        Check(device_->CreateTexture2D(&desc, nullptr, &staging), "NDI staging texture allocation failed");
      }
    }
    // WAIT_TIMEOUT and WAIT_ABANDONED are positive HRESULT values, so FAILED()
    // would incorrectly permit an unsynchronized copy.
    if (surface.keyedMutex && surface.keyedMutex->AcquireSync(0, 1000) != S_OK) {
      throw std::runtime_error("NDI shared texture synchronization failed");
    }
    context_->CopyResource(staging_[slot].Get(), surface.texture.Get());
    if (surface.keyedMutex && surface.keyedMutex->ReleaseSync(0) != S_OK) {
      throw std::runtime_error("NDI shared texture release failed");
    }
    D3D11_MAPPED_SUBRESOURCE mapped{};
    Check(context_->Map(staging_[slot].Get(), 0, D3D11_MAP_READ, 0, &mapped), "NDI shared texture readback failed");
    auto& output = pixels_[slot];
    for (int y = 0; y < height_; ++y) {
      const auto* source = static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch;
      auto* target = output.data() + static_cast<size_t>(y) * width_ * 4;
      std::memcpy(target, source, static_cast<size_t>(width_) * 4);
      for (int x = 0; x < width_; ++x) {
        const unsigned alpha = target[x * 4 + 3];
        if (alpha_ && alpha != 255) {
          for (int color = 0; color < 3; ++color) {
            target[x * 4 + color] = alpha ? static_cast<uint8_t>(std::min(255U,
                (unsigned(target[x * 4 + color]) * 255U + alpha / 2U) / alpha)) : 0;
          }
        } else if (!alpha_) target[x * 4 + 3] = 255;
      }
    }
    context_->Unmap(staging_[slot].Get(), 0);
    const uint32_t fourCC = surface.bgra ? (alpha_ ? 0x41524742U : 0x58524742U)
                                        : (alpha_ ? 0x41424752U : 0x58424752U);
    return {output.data(), output.size(), width_ * 4, fourCC};
  }
 private:
  int32_t width_, height_;
  bool alpha_;
  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> context_;
  ComPtr<ID3D11Texture2D> staging_[2];
  std::vector<uint8_t> pixels_[2];
};

ComPtr<ID3D11Device> Device(IDXGIAdapter* adapter = nullptr) {
  ComPtr<ID3D11Device> device;
  const HRESULT result = D3D11CreateDevice(adapter, adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
      nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &device, nullptr, nullptr);
  if (FAILED(result)) return {};
  return device;
}
const std::vector<ComPtr<ID3D11Device>>& Devices() {
  static const auto devices = [] {
    std::vector<ComPtr<ID3D11Device>> result;
    auto primary = Device();
    if (primary) result.push_back(primary);
    ComPtr<IDXGIFactory1> factory;
    if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
      for (UINT index = 0;; ++index) {
        ComPtr<IDXGIAdapter1> adapter;
        if (factory->EnumAdapters1(index, &adapter) == DXGI_ERROR_NOT_FOUND) break;
        auto device = Device(adapter.Get());
        if (device) result.push_back(device);
      }
    }
    return result;
  }();
  return devices;
}
bool Open(WinSurface& surface, ID3D11Device* device, HANDLE handle) {
  ComPtr<ID3D11Device1> newer;
  if (FAILED(device->QueryInterface(IID_PPV_ARGS(&newer)))) return false;
  if (FAILED(newer->OpenSharedResource1(handle, IID_PPV_ARGS(&surface.texture)))) return false;
  surface.device = device;
  return true;
}
}  // namespace

bool Supported() { return !Devices().empty(); }
std::string ReceiverEndpoint() { return {}; }
uint32_t SurfaceId(const uint8_t*, size_t) { throw std::runtime_error("IOSurface is macOS-only"); }
Handle Export(const uint8_t* bytes, size_t size, int targetPid, const std::string&,
              const std::vector<Plane>&, uint64_t) {
  if (size != sizeof(uintptr_t) || targetPid <= 0) throw std::runtime_error("Invalid shared D3D handle");
  uintptr_t source = 0;
  std::memcpy(&source, bytes, sizeof(source));
  HANDLE process = OpenProcess(PROCESS_DUP_HANDLE, FALSE, static_cast<DWORD>(targetPid));
  if (!process) throw std::runtime_error("NDI host handle-transfer access denied");
  HANDLE target = nullptr;
  const BOOL copied = DuplicateHandle(GetCurrentProcess(), reinterpret_cast<HANDLE>(source), process,
                                      &target, 0, FALSE, DUPLICATE_SAME_ACCESS);
  CloseHandle(process);
  if (!copied) throw std::runtime_error("Could not transfer shared D3D texture to NDI host");
  Handle exported;
  exported.dxgiHandle = reinterpret_cast<uintptr_t>(target);
  exported.targetPid = targetPid;
  return exported;
}
void Discard(const Handle& handle) {
  if (!handle.dxgiHandle) return;
  if (!handle.targetPid || handle.targetPid == static_cast<int>(GetCurrentProcessId())) {
    CloseHandle(reinterpret_cast<HANDLE>(handle.dxgiHandle));
    return;
  }
  HANDLE process = OpenProcess(PROCESS_DUP_HANDLE, FALSE, static_cast<DWORD>(handle.targetPid));
  if (!process) return;
  HANDLE duplicate = nullptr;
  if (DuplicateHandle(process, reinterpret_cast<HANDLE>(handle.dxgiHandle), GetCurrentProcess(),
                      &duplicate, 0, FALSE, DUPLICATE_CLOSE_SOURCE | DUPLICATE_SAME_ACCESS)) {
    CloseHandle(duplicate);
  }
  CloseHandle(process);
}

std::unique_ptr<Surface> Lookup(uint32_t, int32_t, int32_t, const std::string&) {
  throw std::runtime_error("IOSurface is macOS-only");
}
std::unique_ptr<Surface> Lookup(const Handle& handle, int32_t width, int32_t height, const std::string& format) {
  const HANDLE shared = reinterpret_cast<HANDLE>(handle.dxgiHandle);
  auto surface = std::make_unique<WinSurface>();
  bool opened = false;
  for (const auto& device : Devices()) {
    if ((opened = Open(*surface, device.Get(), shared))) break;
  }
  if (!opened) throw std::runtime_error("Could not import shared D3D texture in NDI host");
  surface->texture.As(&surface->keyedMutex);
  D3D11_TEXTURE2D_DESC desc{};
  surface->texture->GetDesc(&desc);
  surface->bgra = desc.Format == DXGI_FORMAT_B8G8R8A8_UNORM || desc.Format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
  const bool rgba = desc.Format == DXGI_FORMAT_R8G8B8A8_UNORM || desc.Format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB;
  if (desc.Width != static_cast<UINT>(width) || desc.Height != static_cast<UINT>(height)
      || desc.SampleDesc.Count != 1 || desc.MipLevels != 1 || desc.ArraySize != 1
      || (format == "bgra" ? !surface->bgra : !rgba)) {
    throw std::runtime_error("Shared D3D texture metadata does not match frame");
  }
  return surface;
}
std::unique_ptr<Converter> CreateConverter(int32_t width, int32_t height, bool alpha) {
  return std::make_unique<D3DConverter>(width, height, alpha);
}
}  // namespace ndi_gpu
