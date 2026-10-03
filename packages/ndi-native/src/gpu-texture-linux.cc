#include "gpu-texture.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/random.h>
#include <poll.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <map>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace ndi_gpu {
namespace {
void Close(const std::vector<int>& fds) { for (int fd : fds) close(fd); }

// Only descriptors cross this private socket. Scene data and frame bytes do
// not. The directory is owner-only, and the receive table is hard-bounded.
class Receiver {
 public:
  Receiver() {
    char directory[] = "/tmp/lumacast-ndi-gpu-XXXXXX";
    if (!mkdtemp(directory)) throw std::runtime_error("Could not create NDI descriptor directory");
    directory_ = directory;
    path_ = directory_ + "/frames";
    fd_ = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, path_.c_str(), sizeof(address.sun_path) - 1);
    if (fd_ < 0 || bind(fd_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
      if (fd_ >= 0) close(fd_);
      unlink(path_.c_str());
      rmdir(directory_.c_str());
      throw std::runtime_error("Could not bind NDI descriptor receiver");
    }
    thread_ = std::thread([this] { Run(); });
  }
  ~Receiver() {
    stopped_ = true;
    thread_.join();
    close(fd_);
    for (const auto& entry : pending_) Close(entry.second.first);
    unlink(path_.c_str());
    rmdir(directory_.c_str());
  }
  const std::string& Path() const { return path_; }
  std::vector<int> Take(const std::string& token) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!ready_.wait_for(lock, std::chrono::milliseconds(500), [&] { return pending_.count(token) != 0; })) {
      ignored_[token] = std::chrono::steady_clock::now();
      throw std::runtime_error("NDI shared texture descriptor handoff timed out");
    }
    auto fds = std::move(pending_.at(token).first);
    pending_.erase(token);
    return fds;
  }
  void Discard(const std::string& token) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto found = pending_.find(token);
    if (found != pending_.end()) { Close(found->second.first); pending_.erase(found); }
    else if (ignored_.size() < 32) ignored_[token] = std::chrono::steady_clock::now();
  }
 private:
  void Run() {
    while (!stopped_) {
      {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        for (auto it = pending_.begin(); it != pending_.end();) {
          if (now - it->second.second > std::chrono::seconds(2)) {
            Close(it->second.first); it = pending_.erase(it);
          } else ++it;
        }
        for (auto it = ignored_.begin(); it != ignored_.end();) {
          if (now - it->second > std::chrono::seconds(2)) it = ignored_.erase(it);
          else ++it;
        }
      }
      pollfd poller{fd_, POLLIN, 0};
      if (poll(&poller, 1, 100) <= 0) continue;
      std::array<char, 32> token{};
      alignas(cmsghdr) char control[CMSG_SPACE(sizeof(int) * 4)]{};
      iovec data{token.data(), token.size()};
      msghdr message{};
      message.msg_iov = &data; message.msg_iovlen = 1;
      message.msg_control = control; message.msg_controllen = sizeof(control);
      const auto length = recvmsg(fd_, &message, MSG_CMSG_CLOEXEC);
      std::vector<int> fds;
      for (auto* header = CMSG_FIRSTHDR(&message); header; header = CMSG_NXTHDR(&message, header)) {
        if (header->cmsg_level != SOL_SOCKET || header->cmsg_type != SCM_RIGHTS) continue;
        if (header->cmsg_len < CMSG_LEN(0)) continue;
        const auto count = (header->cmsg_len - CMSG_LEN(0)) / sizeof(int);
        const auto* received = reinterpret_cast<const int*>(CMSG_DATA(header));
        fds.insert(fds.end(), received, received + count);
      }
      const std::string key(token.data(), token.size());
      std::lock_guard<std::mutex> lock(mutex_);
      if (length != 32 || (message.msg_flags & (MSG_TRUNC | MSG_CTRUNC))
          || fds.empty() || fds.size() > 4 || pending_.size() >= 32
          || ignored_.erase(key) != 0 || pending_.count(key)) {
        Close(fds);
        continue;
      }
      pending_.emplace(key, std::make_pair(std::move(fds), std::chrono::steady_clock::now()));
      ready_.notify_all();
    }
  }
  int fd_ = -1;
  std::string directory_, path_;
  std::atomic<bool> stopped_{false};
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable ready_;
  std::map<std::string, std::pair<std::vector<int>, std::chrono::steady_clock::time_point>> pending_;
  std::map<std::string, std::chrono::steady_clock::time_point> ignored_;
};
Receiver& SharedReceiver() { static Receiver receiver; return receiver; }

struct LinuxSurface final : Surface {
  std::vector<int> fds;
  Handle handle;
  ~LinuxSurface() override { Close(fds); }
};

// Multiple senders can own converters on the same EGLDisplay. eglTerminate
// invalidates every context on that display, so only the final owner may call it.
class SharedDisplay {
 public:
  EGLDisplay Acquire() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (owners_ == 0) {
      EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
      if (display == EGL_NO_DISPLAY || !eglInitialize(display, nullptr, nullptr)) {
        const auto platform = reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(
            eglGetProcAddress("eglGetPlatformDisplayEXT"));
        display = platform ? platform(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr) : EGL_NO_DISPLAY;
        if (display == EGL_NO_DISPLAY || !eglInitialize(display, nullptr, nullptr)) {
          throw std::runtime_error("NDI EGL display unavailable");
        }
      }
      display_ = display;
    }
    ++owners_;
    return display_;
  }
  void Release() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (--owners_ == 0) {
      eglTerminate(display_);
      display_ = EGL_NO_DISPLAY;
    }
  }
 private:
  std::mutex mutex_;
  EGLDisplay display_ = EGL_NO_DISPLAY;
  size_t owners_ = 0;
};
SharedDisplay& DisplayPool() {
  // Process teardown order must not terminate EGL before live converters die.
  static auto* pool = new SharedDisplay();
  return *pool;
}

struct CurrentContext {
  EGLDisplay display;
  ~CurrentContext() { eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT); }
};

class EglConverter final : public Converter {
 public:
  EglConverter(int32_t width, int32_t height, bool alpha) : width_(width), height_(height), alpha_(alpha) {
    for (auto& output : output_) output.resize(static_cast<size_t>(width) * height * 4);
  }
  ~EglConverter() override {
    if (display_ != EGL_NO_DISPLAY) {
      if (context_ != EGL_NO_CONTEXT) eglDestroyContext(display_, context_);
      if (surface_ != EGL_NO_SURFACE) eglDestroySurface(display_, surface_);
      DisplayPool().Release();
    }
  }
  Pixels Convert(Surface& imported, int slot) override {
    auto& input = static_cast<LinuxSurface&>(imported);
    Initialize();
    if (!eglMakeCurrent(display_, surface_, surface_, context_)) throw std::runtime_error("NDI EGL context unavailable");
    CurrentContext current{display_};
    std::vector<EGLint> attributes{EGL_WIDTH, width_, EGL_HEIGHT, height_, EGL_LINUX_DRM_FOURCC_EXT,
                                 static_cast<EGLint>(input.handle.surfaceId)};
    constexpr EGLint fdKeys[] = {EGL_DMA_BUF_PLANE0_FD_EXT, EGL_DMA_BUF_PLANE1_FD_EXT,
                                EGL_DMA_BUF_PLANE2_FD_EXT, EGL_DMA_BUF_PLANE3_FD_EXT};
    constexpr EGLint offsetKeys[] = {EGL_DMA_BUF_PLANE0_OFFSET_EXT, EGL_DMA_BUF_PLANE1_OFFSET_EXT,
                                    EGL_DMA_BUF_PLANE2_OFFSET_EXT, EGL_DMA_BUF_PLANE3_OFFSET_EXT};
    constexpr EGLint pitchKeys[] = {EGL_DMA_BUF_PLANE0_PITCH_EXT, EGL_DMA_BUF_PLANE1_PITCH_EXT,
                                   EGL_DMA_BUF_PLANE2_PITCH_EXT, EGL_DMA_BUF_PLANE3_PITCH_EXT};
    constexpr EGLint lowKeys[] = {EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_LO_EXT,
                                 EGL_DMA_BUF_PLANE2_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_LO_EXT};
    constexpr EGLint highKeys[] = {EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_HI_EXT,
                                  EGL_DMA_BUF_PLANE2_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_HI_EXT};
    const char* extensions = eglQueryString(display_, EGL_EXTENSIONS);
    const bool modifiers = extensions && std::strstr(extensions, "EGL_EXT_image_dma_buf_import_modifiers");
    if (!modifiers && input.handle.modifier != 0 && input.handle.modifier != UINT64_MAX) {
      throw std::runtime_error("NDI driver cannot import this DMA-BUF modifier");
    }
    for (size_t i = 0; i < input.fds.size(); ++i) {
      const auto& plane = input.handle.planes[i];
      attributes.insert(attributes.end(), {fdKeys[i], input.fds[i], offsetKeys[i], static_cast<EGLint>(plane.offset),
                                          pitchKeys[i], static_cast<EGLint>(plane.stride)});
      if (modifiers && input.handle.modifier != UINT64_MAX) {
        attributes.insert(attributes.end(), {lowKeys[i], static_cast<EGLint>(input.handle.modifier),
                                            highKeys[i], static_cast<EGLint>(input.handle.modifier >> 32)});
      }
    }
    attributes.push_back(EGL_NONE);
    const auto create = reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(eglGetProcAddress("eglCreateImageKHR"));
    const auto destroy = reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(eglGetProcAddress("eglDestroyImageKHR"));
    const auto attach = reinterpret_cast<PFNGLEGLIMAGETARGETTEXTURE2DOESPROC>(eglGetProcAddress("glEGLImageTargetTexture2DOES"));
    EGLImageKHR image = create(display_, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, nullptr, attributes.data());
    if (image == EGL_NO_IMAGE_KHR) {
      throw std::runtime_error("Could not import Chromium DMA-BUF into EGL");
    }
    GLuint texture = 0, framebuffer = 0;
    glGenTextures(1, &texture); glBindTexture(GL_TEXTURE_2D, texture);
    attach(GL_TEXTURE_2D, image);
    glGenFramebuffers(1, &framebuffer); glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    const bool complete = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    if (complete) glReadPixels(0, 0, width_, height_, GL_RGBA, GL_UNSIGNED_BYTE, output_[slot].data());
    const GLenum error = glGetError();
    glDeleteFramebuffers(1, &framebuffer); glDeleteTextures(1, &texture); destroy(display_, image);
    if (!complete || error != GL_NO_ERROR) throw std::runtime_error("NDI DMA-BUF readback failed");
    auto& output = output_[slot];
    // glReadPixels returns rows from the lower edge of the framebuffer;
    // NDI frames use top-to-bottom row order.
    const size_t rowBytes = static_cast<size_t>(width_) * 4;
    std::vector<uint8_t> row(rowBytes);
    for (int y = 0; y < height_ / 2; ++y) {
      auto* top = output.data() + static_cast<size_t>(y) * rowBytes;
      auto* bottom = output.data() + static_cast<size_t>(height_ - y - 1) * rowBytes;
      std::memcpy(row.data(), top, rowBytes);
      std::memcpy(top, bottom, rowBytes);
      std::memcpy(bottom, row.data(), rowBytes);
    }
    for (size_t i = 0; i < output.size(); i += 4) {
      const unsigned alpha = output[i + 3];
      if (alpha_ && alpha != 255) {
        for (int color = 0; color < 3; ++color) output[i + color] = alpha
          ? static_cast<uint8_t>(std::min(255U, (unsigned(output[i + color]) * 255U + alpha / 2U) / alpha)) : 0;
      } else if (!alpha_) output[i + 3] = 255;
    }
    return {output.data(), output.size(), width_ * 4, alpha_ ? 0x41424752U : 0x58424752U};
  }
 private:
  void Initialize() {
    if (context_ != EGL_NO_CONTEXT) return;
    if (display_ == EGL_NO_DISPLAY) display_ = DisplayPool().Acquire();
    if (surface_ != EGL_NO_SURFACE) {
      eglDestroySurface(display_, surface_);
      surface_ = EGL_NO_SURFACE;
    }
    const char* extensions = eglQueryString(display_, EGL_EXTENSIONS);
    if (!extensions || !std::strstr(extensions, "EGL_EXT_image_dma_buf_import")
        || !eglGetProcAddress("eglCreateImageKHR") || !eglGetProcAddress("eglDestroyImageKHR")
        || !eglGetProcAddress("glEGLImageTargetTexture2DOES")) {
      throw std::runtime_error("NDI EGL DMA-BUF import unavailable");
    }
    if (!eglBindAPI(EGL_OPENGL_ES_API)) throw std::runtime_error("NDI EGL API unavailable");
    const EGLint configAttributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
                                      EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
    EGLConfig config;
    EGLint count = 0;
    if (!eglChooseConfig(display_, configAttributes, &config, 1, &count) || count == 0) {
      throw std::runtime_error("NDI EGL configuration unavailable");
    }
    const EGLint contextAttributes[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    const EGLint surfaceAttributes[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    EGLSurface surface = eglCreatePbufferSurface(display_, config, surfaceAttributes);
    EGLContext context = eglCreateContext(display_, config, EGL_NO_CONTEXT, contextAttributes);
    if (surface == EGL_NO_SURFACE || context == EGL_NO_CONTEXT) {
      if (context != EGL_NO_CONTEXT) eglDestroyContext(display_, context);
      if (surface != EGL_NO_SURFACE) eglDestroySurface(display_, surface);
      throw std::runtime_error("NDI EGL context creation failed");
    }
    surface_ = surface;
    context_ = context;
  }
  int32_t width_, height_;
  bool alpha_;
  EGLDisplay display_ = EGL_NO_DISPLAY;
  EGLContext context_ = EGL_NO_CONTEXT;
  EGLSurface surface_ = EGL_NO_SURFACE;
  std::vector<uint8_t> output_[2];
};
}  // namespace

bool Supported() { return true; }
std::string ReceiverEndpoint() { return SharedReceiver().Path(); }
uint32_t SurfaceId(const uint8_t*, size_t) { throw std::runtime_error("IOSurface is macOS-only"); }
Handle Export(const uint8_t*, size_t, int, const std::string& endpoint,
              const std::vector<Plane>& planes, uint64_t modifier) {
  if (planes.size() != 1 || planes[0].fd < 0 || planes[0].stride == 0
      || endpoint.empty() || endpoint.size() >= sizeof(sockaddr_un::sun_path)) {
    throw std::runtime_error("Invalid NDI DMA-BUF handoff");
  }
  std::array<unsigned char, 16> random{};
  if (getrandom(random.data(), random.size(), 0) != static_cast<ssize_t>(random.size())) {
    throw std::runtime_error("NDI descriptor token generation failed");
  }
  Handle exported;
  const char* digits = "0123456789abcdef";
  for (auto byte : random) { exported.token += digits[byte >> 4]; exported.token += digits[byte & 15]; }
  exported.planes = planes; exported.modifier = modifier;
  const int socketFd = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
  if (socketFd < 0) throw std::runtime_error("NDI descriptor socket unavailable");
  sockaddr_un address{}; address.sun_family = AF_UNIX;
  std::strncpy(address.sun_path, endpoint.c_str(), sizeof(address.sun_path) - 1);
  alignas(cmsghdr) char control[CMSG_SPACE(sizeof(int) * 4)]{};
  iovec data{exported.token.data(), exported.token.size()};
  msghdr message{}; message.msg_name = &address; message.msg_namelen = sizeof(address);
  message.msg_iov = &data; message.msg_iovlen = 1;
  message.msg_control = control; message.msg_controllen = CMSG_SPACE(planes.size() * sizeof(int));
  auto* header = CMSG_FIRSTHDR(&message);
  header->cmsg_level = SOL_SOCKET; header->cmsg_type = SCM_RIGHTS;
  header->cmsg_len = CMSG_LEN(planes.size() * sizeof(int));
  auto* fds = reinterpret_cast<int*>(CMSG_DATA(header));
  for (size_t i = 0; i < planes.size(); ++i) fds[i] = planes[i].fd;
  const auto sent = sendmsg(socketFd, &message, MSG_DONTWAIT | MSG_NOSIGNAL);
  close(socketFd);
  if (sent != 32) throw std::runtime_error("Could not transfer DMA-BUF descriptors to NDI host");
  return exported;
}
void Discard(const Handle& handle) { SharedReceiver().Discard(handle.token); }
std::unique_ptr<Surface> Lookup(uint32_t, int32_t, int32_t, const std::string&) {
  throw std::runtime_error("IOSurface is macOS-only");
}
std::unique_ptr<Surface> Lookup(const Handle& handle, int32_t width, int32_t height, const std::string& format) {
  auto surface = std::make_unique<LinuxSurface>();
  surface->fds = SharedReceiver().Take(handle.token);
  if (surface->fds.size() != 1 || handle.planes.size() != 1 || width != 1920 || height != 1080) {
    throw std::runtime_error("Invalid NDI DMA-BUF plane metadata");
  }
  const auto& plane = handle.planes[0];
  const uint64_t lastByte = static_cast<uint64_t>(plane.offset)
      + static_cast<uint64_t>(plane.stride) * (height - 1) + static_cast<uint64_t>(width) * 4;
  if (plane.stride < static_cast<uint32_t>(width) * 4 || lastByte > plane.size) {
    throw std::runtime_error("Invalid NDI DMA-BUF plane bounds");
  }
  surface->handle = handle;
  surface->handle.surfaceId = format == "bgra" ? 0x34325241U : 0x34324241U; // DRM AR24 / AB24
  return surface;
}
std::unique_ptr<Converter> CreateConverter(int32_t width, int32_t height, bool alpha) {
  return std::make_unique<EglConverter>(width, height, alpha);
}
}  // namespace ndi_gpu
