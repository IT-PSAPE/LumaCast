#include "gpu-texture.h"

#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>

#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <map>
#include <mutex>
#include <stdexcept>
#include <cstdlib>
#include <thread>
#include <unistd.h>

namespace ndi_gpu {
namespace {

constexpr const char* kShader = R"metal(
#include <metal_stdlib>
using namespace metal;
struct Settings { uint width; uint height; uint alpha; };
uchar quantize(float value) { return uchar(clamp(floor(value + 0.5f), 0.0f, 255.0f)); }
float3 straight(float4 pixel, bool alpha) {
  return alpha ? (pixel.a > 0.0f ? clamp(pixel.rgb / pixel.a, 0.0f, 1.0f) : float3(0.0f)) : pixel.rgb;
}
kernel void convert(texture2d<float, access::read> input [[texture(0)]],
                    device uchar* output [[buffer(0)]],
                    constant Settings& s [[buffer(1)]], uint2 gid [[thread_position_in_grid]]) {
  uint x = gid.x * 2;
  if (x >= s.width || gid.y >= s.height) return;
  float4 p0 = input.read(uint2(x, gid.y));
  float4 p1 = input.read(uint2(x + 1, gid.y));
  float3 c0 = straight(p0, s.alpha != 0);
  float3 c1 = straight(p1, s.alpha != 0);
  float3 average = (c0 + c1) * 0.5f;
  uint at = (gid.y * s.width + x) * 2;
  // Limited-range Rec.709 UYVY. Alpha, when present, is a full-range
  // plane immediately after the color plane (NDI UYVA).
  output[at] = quantize(128.0f + 224.0f * dot(average, float3(-0.114572f, -0.385428f, 0.5f)));
  output[at + 1] = quantize(16.0f + 219.0f * dot(c0, float3(0.2126f, 0.7152f, 0.0722f)));
  output[at + 2] = quantize(128.0f + 224.0f * dot(average, float3(0.5f, -0.454153f, -0.045847f)));
  output[at + 3] = quantize(16.0f + 219.0f * dot(c1, float3(0.2126f, 0.7152f, 0.0722f)));
  if (s.alpha != 0) {
    uint alphaAt = s.width * s.height * 2 + gid.y * s.width + x;
    output[alphaAt] = quantize(p0.a * 255.0f);
    output[alphaAt + 1] = quantize(p1.a * 255.0f);
  }
}
)metal";

struct PortMessage {
  mach_msg_header_t header{};
  mach_msg_body_t body{};
  mach_msg_port_descriptor_t descriptor{};
  char token[32]{};
};

class Receiver;
std::atomic<Receiver*> gReceiver{nullptr};

// An IOSurface ID is insufficient for Chromium's process-local surfaces.
// Transfer an IOSurface send right through a private, randomly named Mach
// service instead. A bounded table owns each received right until consumed.
class Receiver {
 public:
  Receiver() {
    std::array<unsigned char, 16> random{};
    arc4random_buf(random.data(), random.size());
    const char* digits = "0123456789abcdef";
    name_ = "com.lumacast.ndi.gpu." + std::to_string(getpid()) + ".";
    for (auto byte : random) { name_ += digits[byte >> 4]; name_ += digits[byte & 15]; }
    if (mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &port_) != KERN_SUCCESS) {
      throw std::runtime_error("Could not create NDI IOSurface receiver");
    }
    name_t service{};
    std::strncpy(service, name_.c_str(), sizeof(service) - 1);
    if (bootstrap_register(bootstrap_port, service, port_) != KERN_SUCCESS) {
      mach_port_mod_refs(mach_task_self(), port_, MACH_PORT_RIGHT_RECEIVE, -1);
      throw std::runtime_error("Could not register NDI IOSurface receiver");
    }
    try { thread_ = std::thread([this] { Run(); }); }
    catch (...) {
      const auto unregistered = bootstrap_register(bootstrap_port, service, MACH_PORT_NULL);
      (void)unregistered;
      mach_port_mod_refs(mach_task_self(), port_, MACH_PORT_RIGHT_RECEIVE, -1);
      throw;
    }
  }
  ~Receiver() {
    gReceiver.store(nullptr);
    stopped_ = true;
    thread_.join();
    name_t service{};
    std::strncpy(service, name_.c_str(), sizeof(service) - 1);
    const auto unregistered = bootstrap_register(bootstrap_port, service, MACH_PORT_NULL);
    (void)unregistered;
    for (const auto& entry : pending_) mach_port_deallocate(mach_task_self(), entry.second.first);
    mach_port_mod_refs(mach_task_self(), port_, MACH_PORT_RIGHT_RECEIVE, -1);
  }
  const std::string& Name() const { return name_; }
  mach_port_t Take(const std::string& token) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!ready_.wait_for(lock, std::chrono::milliseconds(500), [&] { return pending_.count(token) != 0; })) {
      ignored_[token] = std::chrono::steady_clock::now();
      throw std::runtime_error("NDI IOSurface handoff timed out");
    }
    const mach_port_t port = pending_.at(token).first;
    pending_.erase(token);
    return port;
  }
  void Discard(const std::string& token) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto found = pending_.find(token);
    if (found != pending_.end()) {
      mach_port_deallocate(mach_task_self(), found->second.first);
      pending_.erase(found);
    } else if (ignored_.size() < 32) ignored_[token] = std::chrono::steady_clock::now();
  }
 private:
  void Run() {
    while (!stopped_) {
      {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        for (auto it = pending_.begin(); it != pending_.end();) {
          if (now - it->second.second > std::chrono::seconds(2)) {
            mach_port_deallocate(mach_task_self(), it->second.first);
            it = pending_.erase(it);
          } else ++it;
        }
        for (auto it = ignored_.begin(); it != ignored_.end();) {
          if (now - it->second > std::chrono::seconds(2)) it = ignored_.erase(it);
          else ++it;
        }
      }
      // A received Mach message includes a trailer beyond msgh_size.
      alignas(PortMessage) std::array<uint8_t, 512> storage{};
      auto& message = *reinterpret_cast<PortMessage*>(storage.data());
      const auto status = mach_msg(&message.header, MACH_RCV_MSG | MACH_RCV_TIMEOUT,
                                   0, storage.size(), port_, 100, MACH_PORT_NULL);
      if (status != MACH_MSG_SUCCESS) continue;
      const bool valid = message.header.msgh_size == sizeof(message)
          && (message.header.msgh_bits & MACH_MSGH_BITS_COMPLEX)
          && message.body.msgh_descriptor_count == 1
          && message.descriptor.type == MACH_MSG_PORT_DESCRIPTOR
          && message.descriptor.disposition == MACH_MSG_TYPE_PORT_SEND
          && message.descriptor.name != MACH_PORT_NULL;
      if (!valid) { mach_msg_destroy(&message.header); continue; }
      const std::string key(message.token, sizeof(message.token));
      std::lock_guard<std::mutex> lock(mutex_);
      if (pending_.size() >= 32 || ignored_.erase(key) != 0 || pending_.count(key)) {
        mach_msg_destroy(&message.header);
        continue;
      }
      pending_.emplace(key, std::make_pair(message.descriptor.name, std::chrono::steady_clock::now()));
      message.descriptor.name = MACH_PORT_NULL;
      mach_msg_destroy(&message.header);
      ready_.notify_all();
    }
  }
  mach_port_t port_ = MACH_PORT_NULL;
  std::string name_;
  std::atomic<bool> stopped_{false};
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable ready_;
  std::map<std::string, std::pair<mach_port_t, std::chrono::steady_clock::time_point>> pending_;
  std::map<std::string, std::chrono::steady_clock::time_point> ignored_;
};
Receiver& SharedReceiver() {
  static Receiver receiver;
  gReceiver.store(&receiver);
  return receiver;
}

struct MacSurface final : Surface {
  IOSurfaceRef value;
  MTLPixelFormat format;
  MacSurface(IOSurfaceRef surface, MTLPixelFormat pixelFormat) : value(surface), format(pixelFormat) {}
  ~MacSurface() override { CFRelease(value); }
};

class MetalConverter final : public Converter {
 public:
  MetalConverter(int32_t width, int32_t height, bool alpha)
      : width_(width), height_(height), alpha_(alpha),
        size_(static_cast<size_t>(width) * height * (alpha ? 3U : 2U)) {
    try { @autoreleasepool {
      device_ = MTLCreateSystemDefaultDevice();
      if (!device_) throw std::runtime_error("Metal device unavailable");
      queue_ = [device_ newCommandQueue];
      NSError* error = nil;
      id<MTLLibrary> library = [device_ newLibraryWithSource:[NSString stringWithUTF8String:kShader]
                                                    options:nil error:&error];
      if (!library) throw std::runtime_error("NDI Metal shader compilation failed");
      id<MTLFunction> function = [library newFunctionWithName:@"convert"];
      pipeline_ = [device_ newComputePipelineStateWithFunction:function error:&error];
      [function release];
      [library release];
      if (!pipeline_ || !queue_) throw std::runtime_error("NDI Metal pipeline unavailable");
      for (auto& buffer : buffers_) {
        buffer = [device_ newBufferWithLength:size_ options:MTLResourceStorageModeShared];
        if (!buffer) throw std::runtime_error("NDI Metal buffer allocation failed");
      }
    } } catch (...) { Release(); throw; }
  }

  ~MetalConverter() override { Release(); }

  void Release() {
    for (auto buffer : buffers_) [buffer release];
    for (auto& buffer : buffers_) buffer = nil;
    [pipeline_ release];
    pipeline_ = nil;
    [queue_ release];
    queue_ = nil;
    [device_ release];
    device_ = nil;
  }

  Pixels Convert(Surface& imported, int slot) override {
    auto& surface = static_cast<MacSurface&>(imported);
    @autoreleasepool {
      MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:surface.format
                                                    width:width_ height:height_ mipmapped:NO];
      desc.usage = MTLTextureUsageShaderRead;
      id<MTLTexture> texture = [device_ newTextureWithDescriptor:desc iosurface:surface.value plane:0];
      if (!texture) throw std::runtime_error("Could not import Chromium IOSurface into Metal");
      id<MTLCommandBuffer> commands = [queue_ commandBuffer];
      id<MTLComputeCommandEncoder> encoder = [commands computeCommandEncoder];
      if (!commands || !encoder) { [texture release]; throw std::runtime_error("Metal command encoder unavailable"); }
      struct Settings { uint32_t width; uint32_t height; uint32_t alpha; } settings{
        static_cast<uint32_t>(width_), static_cast<uint32_t>(height_), alpha_ ? 1U : 0U};
      [encoder setComputePipelineState:pipeline_];
      [encoder setTexture:texture atIndex:0];
      [encoder setBuffer:buffers_[slot] offset:0 atIndex:0];
      [encoder setBytes:&settings length:sizeof(settings) atIndex:1];
      [encoder dispatchThreads:MTLSizeMake(width_ / 2, height_, 1)
          threadsPerThreadgroup:MTLSizeMake(16, 8, 1)];
      [encoder endEncoding];
      [commands commit];
      [commands waitUntilCompleted];
      [texture release];
      if (commands.status != MTLCommandBufferStatusCompleted) throw std::runtime_error("NDI GPU conversion failed");
      const uint32_t fourCC = alpha_ ? 0x41565955U : 0x59565955U;
      return {static_cast<uint8_t*>([buffers_[slot] contents]), size_, width_ * 2, fourCC};
    }
  }

 private:
  int32_t width_, height_;
  bool alpha_;
  size_t size_;
  id<MTLDevice> device_ = nil;
  id<MTLCommandQueue> queue_ = nil;
  id<MTLComputePipelineState> pipeline_ = nil;
  id<MTLBuffer> buffers_[2] = {nil, nil};
};
}  // namespace

bool Supported() {
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  const bool available = device != nil;
  [device release];
  return available;
}

uint32_t SurfaceId(const uint8_t* handle, size_t length) {
  if (length != sizeof(IOSurfaceRef)) throw std::runtime_error("Invalid IOSurface handle size");
  IOSurfaceRef surface = nullptr;
  std::memcpy(&surface, handle, sizeof(surface));
  if (!surface) throw std::runtime_error("Empty IOSurface handle");
  return IOSurfaceGetID(surface);
}

std::string ReceiverEndpoint() { return SharedReceiver().Name(); }
Handle Export(const uint8_t* handle, size_t length, int targetPid, const std::string& endpoint,
              const std::vector<Plane>&, uint64_t) {
  if (targetPid <= 0 || endpoint.empty() || endpoint.size() >= sizeof(name_t)) {
    throw std::runtime_error("Invalid NDI IOSurface receiver");
  }
  if (length != sizeof(IOSurfaceRef)) throw std::runtime_error("Invalid IOSurface handle size");
  IOSurfaceRef surface = nullptr;
  std::memcpy(&surface, handle, sizeof(surface));
  if (!surface) throw std::runtime_error("Empty IOSurface handle");
  mach_port_t surfacePort = IOSurfaceCreateMachPort(surface);
  if (surfacePort == MACH_PORT_NULL) throw std::runtime_error("Could not export IOSurface Mach port");
  mach_port_t receiverPort = MACH_PORT_NULL;
  name_t service{};
  std::strncpy(service, endpoint.c_str(), sizeof(service) - 1);
  if (bootstrap_look_up(bootstrap_port, service, &receiverPort) != KERN_SUCCESS) {
    mach_port_deallocate(mach_task_self(), surfacePort);
    throw std::runtime_error("NDI IOSurface receiver unavailable");
  }
  Handle exported;
  std::array<unsigned char, 16> random{};
  arc4random_buf(random.data(), random.size());
  const char* digits = "0123456789abcdef";
  for (auto byte : random) { exported.token += digits[byte >> 4]; exported.token += digits[byte & 15]; }
  PortMessage message{};
  message.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0) | MACH_MSGH_BITS_COMPLEX;
  message.header.msgh_size = sizeof(message);
  message.header.msgh_remote_port = receiverPort;
  message.body.msgh_descriptor_count = 1;
  message.descriptor.name = surfacePort;
  message.descriptor.disposition = MACH_MSG_TYPE_COPY_SEND;
  message.descriptor.type = MACH_MSG_PORT_DESCRIPTOR;
  std::memcpy(message.token, exported.token.data(), sizeof(message.token));
  const auto status = mach_msg(&message.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
                               sizeof(message), 0, MACH_PORT_NULL, 500, MACH_PORT_NULL);
  mach_port_deallocate(mach_task_self(), receiverPort);
  mach_port_deallocate(mach_task_self(), surfacePort);
  if (status != MACH_MSG_SUCCESS) throw std::runtime_error("Could not transfer IOSurface to NDI host");
  return exported;
}
void Discard(const Handle& handle) {
  if (auto* receiver = gReceiver.load()) receiver->Discard(handle.token);
}
std::unique_ptr<Surface> Lookup(const Handle& handle, int32_t width, int32_t height,
                              const std::string& format) {
  mach_port_t port = SharedReceiver().Take(handle.token);
  IOSurfaceRef surface = IOSurfaceLookupFromMachPort(port);
  mach_port_deallocate(mach_task_self(), port);
  if (!surface) throw std::runtime_error("Transferred IOSurface unavailable in NDI process");
  const bool bgra = format == "bgra";
  const uint32_t pixelFormat = bgra ? 0x42475241U : 0x52474241U;
  if (IOSurfaceGetWidth(surface) != static_cast<size_t>(width)
      || IOSurfaceGetHeight(surface) != static_cast<size_t>(height)
      || IOSurfaceGetBytesPerElement(surface) != 4
      || IOSurfaceGetBytesPerRow(surface) < static_cast<size_t>(width) * 4
      || IOSurfaceGetPixelFormat(surface) != pixelFormat) {
    CFRelease(surface);
    throw std::runtime_error("Transferred IOSurface metadata does not match frame");
  }
  return std::make_unique<MacSurface>(surface, bgra ? MTLPixelFormatBGRA8Unorm : MTLPixelFormatRGBA8Unorm);
}

std::unique_ptr<Surface> Lookup(uint32_t id, int32_t width, int32_t height, const std::string& format) {
  IOSurfaceRef surface = IOSurfaceLookup(id);
  if (!surface) throw std::runtime_error("Shared IOSurface unavailable in NDI process");
  const bool bgra = format == "bgra";
  const uint32_t pixelFormat = bgra ? 0x42475241U : 0x52474241U;
  if (IOSurfaceGetWidth(surface) != static_cast<size_t>(width)
      || IOSurfaceGetHeight(surface) != static_cast<size_t>(height)
      || IOSurfaceGetBytesPerElement(surface) != 4
      || IOSurfaceGetBytesPerRow(surface) < static_cast<size_t>(width) * 4
      || IOSurfaceGetPixelFormat(surface) != pixelFormat) {
    CFRelease(surface);
    throw std::runtime_error("Shared IOSurface metadata does not match frame");
  }
  return std::make_unique<MacSurface>(surface, bgra ? MTLPixelFormatBGRA8Unorm : MTLPixelFormatRGBA8Unorm);
}

std::unique_ptr<Converter> CreateConverter(int32_t width, int32_t height, bool alpha) {
  return std::make_unique<MetalConverter>(width, height, alpha);
}
}  // namespace ndi_gpu
