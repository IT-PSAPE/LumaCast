#include <napi.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <cstring>
#include <unordered_map>
#include <utility>
#include <vector>
#include <thread>
#include <chrono>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

constexpr int64_t kTimecodeSynthesize = std::numeric_limits<int64_t>::max();
constexpr int32_t kFrameFormatProgressive = 1;
constexpr size_t kMaxVideoFrameBytes = static_cast<size_t>(1920) * static_cast<size_t>(1080) * 4U;

constexpr uint32_t MakeFourCC(char a, char b, char c, char d) {
  return static_cast<uint32_t>(static_cast<uint8_t>(a)) |
         (static_cast<uint32_t>(static_cast<uint8_t>(b)) << 8U) |
         (static_cast<uint32_t>(static_cast<uint8_t>(c)) << 16U) |
         (static_cast<uint32_t>(static_cast<uint8_t>(d)) << 24U);
}

constexpr uint32_t kFourCCBgra = MakeFourCC('B', 'G', 'R', 'A');
constexpr uint32_t kFourCCBgrx = MakeFourCC('B', 'G', 'R', 'X');
constexpr uint32_t kFourCCRgba = MakeFourCC('R', 'G', 'B', 'A');
constexpr uint32_t kFourCCRgbx = MakeFourCC('R', 'G', 'B', 'X');

struct NDIlib_send_create_t {
  const char* p_ndi_name;
  const char* p_groups;
  bool clock_video;
  bool clock_audio;
};

struct NDIlib_video_frame_v2_t {
  int32_t xres;
  int32_t yres;
  uint32_t FourCC;
  int32_t frame_rate_N;
  int32_t frame_rate_D;
  float picture_aspect_ratio;
  int32_t frame_format_type;
  int64_t timecode;
  uint8_t* p_data;
  int32_t line_stride_in_bytes;
  const char* p_metadata;
  int64_t timestamp;
};

struct NDIlib_tally_t {
  bool on_program;
  bool on_preview;
};

// Planar 32-bit float audio. Channels are stored back-to-back: channel 0's
// samples first, then channel 1's, separated by channel_stride_in_bytes.
struct NDIlib_audio_frame_v2_t {
  int32_t sample_rate;
  int32_t no_channels;
  int32_t no_samples;
  int64_t timecode;
  float* p_data;
  int32_t channel_stride_in_bytes;
  const char* p_metadata;
  int64_t timestamp;
};

using NDIlib_send_instance_t = void*;

using FnNdiInitialize = bool (*)();
using FnNdiDestroy = void (*)();
using FnNdiSendCreate = NDIlib_send_instance_t (*)(const NDIlib_send_create_t*);
using FnNdiSendDestroy = void (*)(NDIlib_send_instance_t);
using FnNdiSendVideoV2 = void (*)(NDIlib_send_instance_t, const NDIlib_video_frame_v2_t*);
using FnNdiSendVideoAsyncV2 = void (*)(NDIlib_send_instance_t, const NDIlib_video_frame_v2_t*);
using FnNdiSendAudioV2 = void (*)(NDIlib_send_instance_t, const NDIlib_audio_frame_v2_t*);
using FnNdiSendGetNoConnections = int32_t (*)(NDIlib_send_instance_t, uint32_t);
using FnNdiSendGetTally = bool (*)(NDIlib_send_instance_t, NDIlib_tally_t*, uint32_t);

struct NdiSymbols {
  FnNdiInitialize initialize = nullptr;
  FnNdiDestroy destroy = nullptr;
  FnNdiSendCreate sendCreate = nullptr;
  FnNdiSendDestroy sendDestroy = nullptr;
  FnNdiSendVideoV2 sendVideoV2 = nullptr;
  FnNdiSendVideoAsyncV2 sendVideoAsyncV2 = nullptr;
  FnNdiSendAudioV2 sendAudioV2 = nullptr;
  FnNdiSendGetNoConnections sendGetNoConnections = nullptr;
  FnNdiSendGetTally sendGetTally = nullptr;
};

class DynamicLibrary {
 public:
  DynamicLibrary() = default;
  ~DynamicLibrary() { Unload(); }

  DynamicLibrary(const DynamicLibrary&) = delete;
  DynamicLibrary& operator=(const DynamicLibrary&) = delete;

  bool Load(const std::vector<std::string>& candidates, std::string* loadedPath, std::string* error) {
    Unload();

    std::vector<std::string> attempts;
    attempts.reserve(candidates.size());

    for (const auto& candidate : candidates) {
      if (candidate.empty()) {
        continue;
      }

      attempts.push_back(candidate);
#ifdef _WIN32
      handle_ = reinterpret_cast<void*>(LoadLibraryA(candidate.c_str()));
#else
      handle_ = dlopen(candidate.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
      if (handle_ != nullptr) {
        if (loadedPath != nullptr) {
          *loadedPath = candidate;
        }
        return true;
      }
    }

    if (error != nullptr) {
      std::ostringstream stream;
      stream << "Unable to load NDI runtime. Tried: ";
      for (size_t index = 0; index < attempts.size(); ++index) {
        stream << attempts[index];
        if (index + 1 < attempts.size()) {
          stream << ", ";
        }
      }
#ifdef _WIN32
      stream << ". Last Win32 error: " << GetLastError();
#else
      const char* dlError = dlerror();
      if (dlError != nullptr) {
        stream << ". dlerror: " << dlError;
      }
#endif
      *error = stream.str();
    }

    return false;
  }

  void* Resolve(const char* name) const {
    if (handle_ == nullptr) {
      return nullptr;
    }
#ifdef _WIN32
    return reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(handle_), name));
#else
    return dlsym(handle_, name);
#endif
  }

  void Unload() {
    if (handle_ == nullptr) {
      return;
    }
#ifdef _WIN32
    FreeLibrary(reinterpret_cast<HMODULE>(handle_));
#else
    dlclose(handle_);
#endif
    handle_ = nullptr;
  }

 private:
  void* handle_ = nullptr;
};

constexpr int kDoubleBufferCount = 2;

struct SenderInstance {
  NDIlib_send_instance_t sender = nullptr;
  int32_t width = 0;
  int32_t height = 0;
  bool withAlpha = true;
  std::vector<uint8_t> bgraScratch[kDoubleBufferCount];
  int currentBuffer = 0;
};

struct SenderState {
  bool runtimeLoaded = false;
  bool ndiInitialized = false;
  std::string loadedRuntimePath;
  DynamicLibrary runtime;
  NdiSymbols symbols;
  std::unordered_map<std::string, SenderInstance> senders;
  std::mutex mutex;
};

SenderState& State() {
  static SenderState state;
  return state;
}

std::string GetEnvOrEmpty(const char* key) {
  const char* value = std::getenv(key);
  return value != nullptr ? std::string(value) : std::string();
}

void AddCandidateIfMissing(std::vector<std::string>* candidates, const std::string& candidate) {
  if (candidate.empty()) {
    return;
  }
  if (std::find(candidates->begin(), candidates->end(), candidate) == candidates->end()) {
    candidates->push_back(candidate);
  }
}

std::vector<std::string> BuildRuntimeCandidates() {
#ifdef _WIN32
  constexpr const char* fileName = "Processing.NDI.Lib.x64.dll";
#elif __APPLE__
  constexpr const char* fileName = "libndi.dylib";
  constexpr const char* advancedFileName = "libndi_advanced.dylib";
#else
  constexpr const char* fileName = "libndi.so";
#endif

  std::vector<std::string> candidates;
  const std::string explicitFile = GetEnvOrEmpty("CAST_NDI_RUNTIME_PATH");
  const std::string explicitDir = GetEnvOrEmpty("NDI_RUNTIME_DIR");
  const std::string explicitLegacyDir = GetEnvOrEmpty("NDI_RUNTIME_DIR_V5");

  AddCandidateIfMissing(&candidates, explicitFile);

  if (!explicitDir.empty()) {
#ifdef _WIN32
    AddCandidateIfMissing(&candidates, explicitDir + "\\" + fileName);
#else
    AddCandidateIfMissing(&candidates, explicitDir + "/" + fileName);
#ifdef __APPLE__
    AddCandidateIfMissing(&candidates, explicitDir + "/" + advancedFileName);
#endif
#endif
  }

  if (!explicitLegacyDir.empty()) {
#ifdef _WIN32
    AddCandidateIfMissing(&candidates, explicitLegacyDir + "\\" + fileName);
#else
    AddCandidateIfMissing(&candidates, explicitLegacyDir + "/" + fileName);
#ifdef __APPLE__
    AddCandidateIfMissing(&candidates, explicitLegacyDir + "/" + advancedFileName);
#endif
#endif
  }

#ifdef _WIN32
  AddCandidateIfMissing(&candidates, fileName);
  AddCandidateIfMissing(&candidates, "C:\\Program Files\\NDI\\NDI 6 Runtime\\" + std::string(fileName));
  AddCandidateIfMissing(&candidates, "C:\\Program Files\\NDI\\NDI 5 Runtime\\" + std::string(fileName));
#elif __APPLE__
  AddCandidateIfMissing(&candidates, fileName);
  AddCandidateIfMissing(&candidates, advancedFileName);
  AddCandidateIfMissing(&candidates, "/usr/local/lib/libndi.dylib");
  AddCandidateIfMissing(&candidates, "/usr/local/lib/libndi_advanced.dylib");
  AddCandidateIfMissing(&candidates, "/opt/homebrew/lib/libndi.dylib");
  AddCandidateIfMissing(&candidates, "/opt/homebrew/lib/libndi_advanced.dylib");
  AddCandidateIfMissing(&candidates, "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib");
  AddCandidateIfMissing(&candidates, "/Library/NDI SDK for Apple/lib/macOS/libndi_advanced.dylib");
  AddCandidateIfMissing(&candidates, "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi.dylib");
  AddCandidateIfMissing(&candidates, "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi_advanced.dylib");
  AddCandidateIfMissing(&candidates, "/Applications/NDI Discovery.app/Contents/Frameworks/libndi_advanced.dylib");
  AddCandidateIfMissing(&candidates, "/Applications/NDI Scan Converter.app/Contents/Frameworks/libndi.dylib");
  AddCandidateIfMissing(&candidates, "/Applications/NDI Virtual Input.app/Contents/Frameworks/libndi_advanced.dylib");
  AddCandidateIfMissing(
      &candidates,
      "/Applications/NDI Router.app/Contents/Frameworks/NTFramework.framework/Versions/Current/Frameworks/libndi.dylib");
  AddCandidateIfMissing(
      &candidates,
      "/Applications/NDI Router.app/Contents/Frameworks/NTFramework.framework/Versions/A/Frameworks/libndi.dylib");
#else
  AddCandidateIfMissing(&candidates, "libndi.so.6");
  AddCandidateIfMissing(&candidates, "libndi.so");
  AddCandidateIfMissing(&candidates, "/usr/lib/libndi.so");
  AddCandidateIfMissing(&candidates, "/usr/local/lib/libndi.so");
#endif

  return candidates;
}

template <typename T>
T ResolveRequired(const DynamicLibrary& runtime, const char* symbolName) {
  void* symbol = runtime.Resolve(symbolName);
  if (symbol == nullptr) {
    throw std::runtime_error(std::string("Missing NDI symbol: ") + symbolName);
  }
  return reinterpret_cast<T>(symbol);
}

template <typename T>
T ResolveOptional(const DynamicLibrary& runtime, const char* symbolName) {
  void* symbol = runtime.Resolve(symbolName);
  if (symbol == nullptr) {
    return nullptr;
  }
  return reinterpret_cast<T>(symbol);
}

bool DimensionsAreValid(int32_t width, int32_t height) {
  if (width <= 0 || height <= 0) {
    return false;
  }

  const int64_t totalPixels = static_cast<int64_t>(width) * static_cast<int64_t>(height);
  if (totalPixels <= 0 || totalPixels > static_cast<int64_t>(std::numeric_limits<int32_t>::max())) {
    return false;
  }

  return true;
}

bool TryComputeSize(int32_t stride, int32_t height, size_t* out) {
  if (stride <= 0 || height <= 0) {
    return false;
  }

  const int64_t value = static_cast<int64_t>(stride) * static_cast<int64_t>(height);
  if (value <= 0) {
    return false;
  }

  const uint64_t unsignedValue = static_cast<uint64_t>(value);
  if (unsignedValue > std::numeric_limits<size_t>::max()) {
    return false;
  }

  if (unsignedValue > kMaxVideoFrameBytes) {
    return false;
  }

  *out = static_cast<size_t>(unsignedValue);
  return true;
}

void LoadRuntimeIfNeeded(SenderState& state) {
  if (state.runtimeLoaded) {
    return;
  }

  std::string error;
  const std::vector<std::string> candidates = BuildRuntimeCandidates();
  if (!state.runtime.Load(candidates, &state.loadedRuntimePath, &error)) {
    throw std::runtime_error(error);
  }

  state.symbols.initialize = ResolveRequired<FnNdiInitialize>(state.runtime, "NDIlib_initialize");
  state.symbols.destroy = ResolveRequired<FnNdiDestroy>(state.runtime, "NDIlib_destroy");
  state.symbols.sendCreate = ResolveRequired<FnNdiSendCreate>(state.runtime, "NDIlib_send_create");
  state.symbols.sendDestroy = ResolveRequired<FnNdiSendDestroy>(state.runtime, "NDIlib_send_destroy");
  state.symbols.sendVideoV2 = ResolveRequired<FnNdiSendVideoV2>(state.runtime, "NDIlib_send_send_video_v2");
  state.symbols.sendVideoAsyncV2 =
      ResolveOptional<FnNdiSendVideoAsyncV2>(state.runtime, "NDIlib_send_send_video_async_v2");
  state.symbols.sendAudioV2 =
      ResolveOptional<FnNdiSendAudioV2>(state.runtime, "NDIlib_send_send_audio_v2");
  state.symbols.sendGetNoConnections =
      ResolveOptional<FnNdiSendGetNoConnections>(state.runtime, "NDIlib_send_get_no_connections");
  state.symbols.sendGetTally =
      ResolveOptional<FnNdiSendGetTally>(state.runtime, "NDIlib_send_get_tally");

  state.runtimeLoaded = true;
}

void InitializeNdiIfNeeded(SenderState& state) {
  if (state.ndiInitialized) {
    return;
  }

  if (!state.symbols.initialize || !state.symbols.initialize()) {
    throw std::runtime_error("NDIlib_initialize failed");
  }

  state.ndiInitialized = true;
}

void DestroySenderInstanceUnlocked(SenderState& state, SenderInstance* sender) {
  if (sender == nullptr) {
    return;
  }

  if (sender->sender != nullptr) {
    // Send an opaque black frame before tearing down so remote receivers
    // see black instead of a frozen last frame.
    if (state.symbols.sendVideoV2 != nullptr && sender->width > 0 && sender->height > 0) {
      const int32_t stride = sender->width * 4;
      auto& scratch = sender->bgraScratch[sender->currentBuffer];
      if (!scratch.empty()) {
        // BGRX: B=0, G=0, R=0, X=255 (opaque black)
        std::memset(scratch.data(), 0, scratch.size());
        for (size_t i = 3; i < scratch.size(); i += 4) {
          scratch[i] = 255;
        }

        NDIlib_video_frame_v2_t frame{};
        frame.xres = sender->width;
        frame.yres = sender->height;
        frame.FourCC = kFourCCBgrx;
        frame.frame_rate_N = 60000;
        frame.frame_rate_D = 1001;
        frame.picture_aspect_ratio =
            static_cast<float>(sender->width) / static_cast<float>(sender->height);
        frame.frame_format_type = kFrameFormatProgressive;
        frame.timecode = kTimecodeSynthesize;
        frame.p_data = scratch.data();
        frame.line_stride_in_bytes = stride;
        frame.p_metadata = nullptr;
        frame.timestamp = 0;

        state.symbols.sendVideoV2(sender->sender, &frame);

        // Flush: NDIlib_send_send_video_async_v2(sender, NULL) acts as a
        // synchronization barrier, blocking until pending frames are processed.
        if (state.symbols.sendVideoAsyncV2 != nullptr) {
          state.symbols.sendVideoAsyncV2(sender->sender, nullptr);
        }

        // Brief sleep to let the network stack deliver the frame.
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
    }

    if (state.symbols.sendDestroy != nullptr) {
      state.symbols.sendDestroy(sender->sender);
    }
  }

  sender->sender = nullptr;
  sender->width = 0;
  sender->height = 0;
  sender->withAlpha = true;
  sender->currentBuffer = 0;
  for (int i = 0; i < kDoubleBufferCount; ++i) {
    std::vector<uint8_t>().swap(sender->bgraScratch[i]);
  }
}

void DestroyAllSendersUnlocked(SenderState& state) {
  for (auto& entry : state.senders) {
    DestroySenderInstanceUnlocked(state, &entry.second);
  }
  state.senders.clear();
}

void ShutdownRuntimeUnlocked(SenderState& state) {
  DestroyAllSendersUnlocked(state);

  if (state.ndiInitialized && state.symbols.destroy != nullptr) {
    state.symbols.destroy();
  }

  state.runtime.Unload();
  state.runtimeLoaded = false;
  state.ndiInitialized = false;
  state.loadedRuntimePath.clear();
  state.symbols = NdiSymbols{};
}

void EnsureSender(SenderState& state,
                  const std::string& senderName,
                  int32_t width,
                  int32_t height,
                  bool withAlpha) {
  LoadRuntimeIfNeeded(state);
  InitializeNdiIfNeeded(state);

  auto existing = state.senders.find(senderName);
  if (existing != state.senders.end()) {
    const SenderInstance& sender = existing->second;
    if (sender.sender != nullptr && sender.width == width && sender.height == height && sender.withAlpha == withAlpha) {
      return;
    }

    DestroySenderInstanceUnlocked(state, &existing->second);
    state.senders.erase(existing);
  }

  NDIlib_send_create_t createDesc{};
  createDesc.p_ndi_name = senderName.c_str();
  createDesc.p_groups = nullptr;
  createDesc.clock_video = true;
  createDesc.clock_audio = false;

  NDIlib_send_instance_t sender = state.symbols.sendCreate(&createDesc);
  if (sender == nullptr) {
    throw std::runtime_error("NDIlib_send_create failed");
  }

  SenderInstance instance{};
  instance.sender = sender;
  instance.width = width;
  instance.height = height;
  instance.withAlpha = withAlpha;

  const int32_t stride = width * 4;
  size_t size = 0;
  if (!TryComputeSize(stride, height, &size)) {
    state.symbols.sendDestroy(sender);
    throw std::runtime_error("invalid sender dimensions");
  }

  for (int i = 0; i < kDoubleBufferCount; ++i) {
    instance.bgraScratch[i].resize(size);
  }
  state.senders[senderName] = std::move(instance);
}

void CopyBgraFrame(const uint8_t* source,
                   uint8_t* target,
                   int32_t width,
                   int32_t height,
                   int32_t sourceStride,
                   int32_t targetStride,
                   bool withAlpha) {
  if (withAlpha) {
    for (int32_t y = 0; y < height; ++y) {
      const uint8_t* srcLine = source + static_cast<size_t>(y) * static_cast<size_t>(sourceStride);
      uint8_t* dstLine = target + static_cast<size_t>(y) * static_cast<size_t>(targetStride);
      std::memcpy(dstLine, srcLine, static_cast<size_t>(targetStride));
    }
    return;
  }

  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* srcLine = source + static_cast<size_t>(y) * static_cast<size_t>(sourceStride);
    uint8_t* dstLine = target + static_cast<size_t>(y) * static_cast<size_t>(targetStride);

    for (int32_t x = 0; x < width; ++x) {
      dstLine[x * 4 + 0] = srcLine[x * 4 + 0];
      dstLine[x * 4 + 1] = srcLine[x * 4 + 1];
      dstLine[x * 4 + 2] = srcLine[x * 4 + 2];
      dstLine[x * 4 + 3] = 255;
    }
  }
}

void CopyRgbaFrame(const uint8_t* source,
                   uint8_t* target,
                   int32_t width,
                   int32_t height,
                   int32_t sourceStride,
                   int32_t targetStride,
                   bool withAlpha) {
  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* srcLine = source + static_cast<size_t>(y) * static_cast<size_t>(sourceStride);
    uint8_t* dstLine = target + static_cast<size_t>(y) * static_cast<size_t>(targetStride);

    for (int32_t x = 0; x < width; ++x) {
      dstLine[x * 4 + 0] = srcLine[x * 4 + 0];
      dstLine[x * 4 + 1] = srcLine[x * 4 + 1];
      dstLine[x * 4 + 2] = srcLine[x * 4 + 2];
      dstLine[x * 4 + 3] = withAlpha ? srcLine[x * 4 + 3] : static_cast<uint8_t>(255);
    }
  }
}

Napi::Value InitializeSender(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "initializeSender expects a config object").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object config = info[0].As<Napi::Object>();
  const std::string senderName = config.Get("senderName").ToString().Utf8Value();
  const int32_t width = config.Get("width").ToNumber().Int32Value();
  const int32_t height = config.Get("height").ToNumber().Int32Value();
  const bool withAlpha = config.Get("withAlpha").ToBoolean().Value();

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!DimensionsAreValid(width, height)) {
    Napi::TypeError::New(env, "width and height must be positive and within limits").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  try {
    EnsureSender(state, senderName, width, height, withAlpha);
  } catch (const std::exception& error) {
    Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
  }

  return env.Undefined();
}

Napi::Value SendBgraFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 5 || !info[0].IsString() || !info[1].IsTypedArray() || !info[2].IsNumber() ||
      !info[3].IsNumber() || !info[4].IsNumber()) {
    Napi::TypeError::New(env, "sendBgraFrame expects (senderName, Uint8Array, width, height, stride)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  Napi::Uint8Array bgra = info[1].As<Napi::Uint8Array>();
  const int32_t width = info[2].As<Napi::Number>().Int32Value();
  const int32_t height = info[3].As<Napi::Number>().Int32Value();
  const int32_t stride = info[4].As<Napi::Number>().Int32Value();

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!DimensionsAreValid(width, height) || stride < width * 4) {
    Napi::TypeError::New(env, "invalid frame dimensions or stride").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t requiredSize = 0;
  if (!TryComputeSize(stride, height, &requiredSize)) {
    Napi::TypeError::New(env, "invalid frame size").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (bgra.ByteLength() < requiredSize) {
    Napi::TypeError::New(env, "frame buffer is too small for provided dimensions").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  auto senderIt = state.senders.find(senderName);
  if (senderIt == state.senders.end() || senderIt->second.sender == nullptr) {
    Napi::Error::New(env, "NDI sender not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  SenderInstance& sender = senderIt->second;
  if (width != sender.width || height != sender.height) {
    Napi::Error::New(env, "frame dimensions do not match sender configuration").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int32_t targetStride = width * 4;
  size_t targetSize = 0;
  if (!TryComputeSize(targetStride, height, &targetSize)) {
    Napi::Error::New(env, "invalid target frame size").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int bufIdx = sender.currentBuffer;
  std::vector<uint8_t>& scratch = sender.bgraScratch[bufIdx];

  if (scratch.size() < targetSize) {
    scratch.resize(targetSize);
  }

  CopyBgraFrame(bgra.Data(),
                scratch.data(),
                width,
                height,
                stride,
                targetStride,
                sender.withAlpha);

  NDIlib_video_frame_v2_t frame{};
  frame.xres = width;
  frame.yres = height;
  frame.FourCC = sender.withAlpha ? kFourCCBgra : kFourCCBgrx;
  frame.frame_rate_N = 60000;
  frame.frame_rate_D = 1001;
  frame.picture_aspect_ratio = static_cast<float>(width) / static_cast<float>(height);
  frame.frame_format_type = kFrameFormatProgressive;
  frame.timecode = kTimecodeSynthesize;
  frame.p_data = scratch.data();
  frame.line_stride_in_bytes = targetStride;
  frame.p_metadata = nullptr;
  frame.timestamp = 0;

  if (state.symbols.sendVideoAsyncV2 != nullptr) {
    state.symbols.sendVideoAsyncV2(sender.sender, &frame);
  } else {
    state.symbols.sendVideoV2(sender.sender, &frame);
  }
  sender.currentBuffer = (bufIdx + 1) % kDoubleBufferCount;

  return env.Undefined();
}

Napi::Value SendRgbaFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 4 || !info[0].IsString() || !info[1].IsTypedArray() || !info[2].IsNumber() ||
      !info[3].IsNumber()) {
    Napi::TypeError::New(env, "sendRgbaFrame expects (senderName, Uint8Array, width, height)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  Napi::Uint8Array rgba = info[1].As<Napi::Uint8Array>();
  const int32_t width = info[2].As<Napi::Number>().Int32Value();
  const int32_t height = info[3].As<Napi::Number>().Int32Value();
  const int32_t stride = width * 4;

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!DimensionsAreValid(width, height)) {
    Napi::TypeError::New(env, "invalid frame dimensions").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  size_t requiredSize = 0;
  if (!TryComputeSize(stride, height, &requiredSize)) {
    Napi::TypeError::New(env, "invalid frame size").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (rgba.ByteLength() < requiredSize) {
    Napi::TypeError::New(env, "frame buffer is too small for provided dimensions").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  auto senderIt = state.senders.find(senderName);
  if (senderIt == state.senders.end() || senderIt->second.sender == nullptr) {
    Napi::Error::New(env, "NDI sender not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  SenderInstance& sender = senderIt->second;
  if (width != sender.width || height != sender.height) {
    Napi::Error::New(env, "frame dimensions do not match sender configuration").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int32_t targetStride = width * 4;
  size_t targetSize = 0;
  if (!TryComputeSize(targetStride, height, &targetSize)) {
    Napi::Error::New(env, "invalid target frame size").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int bufIdx = sender.currentBuffer;
  std::vector<uint8_t>& scratch = sender.bgraScratch[bufIdx];

  if (scratch.size() < targetSize) {
    scratch.resize(targetSize);
  }

  CopyRgbaFrame(rgba.Data(),
                scratch.data(),
                width,
                height,
                stride,
                targetStride,
                sender.withAlpha);

  NDIlib_video_frame_v2_t frame{};
  frame.xres = width;
  frame.yres = height;
  frame.FourCC = sender.withAlpha ? kFourCCRgba : kFourCCRgbx;
  frame.frame_rate_N = 60000;
  frame.frame_rate_D = 1001;
  frame.picture_aspect_ratio = static_cast<float>(width) / static_cast<float>(height);
  frame.frame_format_type = kFrameFormatProgressive;
  frame.timecode = kTimecodeSynthesize;
  frame.p_data = scratch.data();
  frame.line_stride_in_bytes = targetStride;
  frame.p_metadata = nullptr;
  frame.timestamp = 0;

  if (state.symbols.sendVideoAsyncV2 != nullptr) {
    state.symbols.sendVideoAsyncV2(sender.sender, &frame);
  } else {
    state.symbols.sendVideoV2(sender.sender, &frame);
  }
  sender.currentBuffer = (bufIdx + 1) % kDoubleBufferCount;

  return env.Undefined();
}

// Sends planar 32-bit float audio. The Float32Array holds channels back-to-
// back: [ch0 samples..., ch1 samples..., ...]. Length must equal
// channels * samplesPerChannel.
Napi::Value SendAudioFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 5 || !info[0].IsString() || !info[1].IsTypedArray() || !info[2].IsNumber() ||
      !info[3].IsNumber() || !info[4].IsNumber()) {
    Napi::TypeError::New(env, "sendAudioFrame expects (senderName, Float32Array, sampleRate, channels, samplesPerChannel)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::TypedArray typed = info[1].As<Napi::TypedArray>();
  if (typed.TypedArrayType() != napi_float32_array) {
    Napi::TypeError::New(env, "sendAudioFrame expects a Float32Array").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  Napi::Float32Array samples = info[1].As<Napi::Float32Array>();
  const int32_t sampleRate = info[2].As<Napi::Number>().Int32Value();
  const int32_t channels = info[3].As<Napi::Number>().Int32Value();
  const int32_t samplesPerChannel = info[4].As<Napi::Number>().Int32Value();

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (sampleRate <= 0 || channels <= 0 || samplesPerChannel <= 0) {
    Napi::TypeError::New(env, "audio frame requires positive sampleRate/channels/samplesPerChannel")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int64_t expectedLength = static_cast<int64_t>(channels) * static_cast<int64_t>(samplesPerChannel);
  if (expectedLength <= 0 || expectedLength > static_cast<int64_t>(std::numeric_limits<int32_t>::max())) {
    Napi::TypeError::New(env, "audio frame channel count × samples overflow").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (samples.ElementLength() < static_cast<size_t>(expectedLength)) {
    Napi::TypeError::New(env, "audio buffer is shorter than channels × samplesPerChannel")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  if (state.symbols.sendAudioV2 == nullptr) {
    Napi::Error::New(env, "NDIlib_send_send_audio_v2 unavailable in loaded runtime").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto senderIt = state.senders.find(senderName);
  if (senderIt == state.senders.end() || senderIt->second.sender == nullptr) {
    Napi::Error::New(env, "NDI sender not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NDIlib_audio_frame_v2_t frame{};
  frame.sample_rate = sampleRate;
  frame.no_channels = channels;
  frame.no_samples = samplesPerChannel;
  frame.timecode = kTimecodeSynthesize;
  frame.p_data = samples.Data();
  frame.channel_stride_in_bytes = samplesPerChannel * static_cast<int32_t>(sizeof(float));
  frame.p_metadata = nullptr;
  frame.timestamp = 0;

  state.symbols.sendAudioV2(senderIt->second.sender, &frame);
  return env.Undefined();
}

Napi::Value GetSenderConnections(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || info.Length() > 2 || !info[0].IsString() || (info.Length() == 2 && !info[1].IsNumber())) {
    Napi::TypeError::New(env, "getSenderConnections expects (senderName, timeoutMs?)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  const uint32_t timeoutMs = info.Length() == 2
      ? static_cast<uint32_t>(std::max<int32_t>(0, info[1].As<Napi::Number>().Int32Value()))
      : 0U;

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  if (state.symbols.sendGetNoConnections == nullptr) {
    return Napi::Number::New(env, -1);
  }

  auto senderIt = state.senders.find(senderName);
  if (senderIt == state.senders.end() || senderIt->second.sender == nullptr) {
    return Napi::Number::New(env, 0);
  }

  const int32_t count = state.symbols.sendGetNoConnections(senderIt->second.sender, timeoutMs);
  return Napi::Number::New(env, count);
}

Napi::Value GetSenderTally(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || info.Length() > 2 || !info[0].IsString() || (info.Length() == 2 && !info[1].IsNumber())) {
    Napi::TypeError::New(env, "getSenderTally expects (senderName, timeoutMs?)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  const uint32_t timeoutMs = info.Length() == 2
      ? static_cast<uint32_t>(std::max<int32_t>(0, info[1].As<Napi::Number>().Int32Value()))
      : 0U;

  if (senderName.empty()) {
    Napi::TypeError::New(env, "senderName must be non-empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  if (state.symbols.sendGetTally == nullptr) {
    return env.Null();
  }

  auto senderIt = state.senders.find(senderName);
  if (senderIt == state.senders.end() || senderIt->second.sender == nullptr) {
    return env.Null();
  }

  NDIlib_tally_t tally{};
  state.symbols.sendGetTally(senderIt->second.sender, &tally, timeoutMs);
  Napi::Object out = Napi::Object::New(env);
  out.Set("onProgram", Napi::Boolean::New(env, tally.on_program));
  out.Set("onPreview", Napi::Boolean::New(env, tally.on_preview));
  return out;
}

Napi::Value DestroySender(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() > 1 || (info.Length() == 1 && !info[0].IsString())) {
    Napi::TypeError::New(env, "destroySender expects optional senderName string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  if (info.Length() == 0) {
    ShutdownRuntimeUnlocked(state);
    return env.Undefined();
  }

  const std::string senderName = info[0].As<Napi::String>().Utf8Value();
  const auto senderIt = state.senders.find(senderName);
  if (senderIt != state.senders.end()) {
    DestroySenderInstanceUnlocked(state, &senderIt->second);
    state.senders.erase(senderIt);
  }

  if (state.senders.empty()) {
    ShutdownRuntimeUnlocked(state);
  }

  return env.Undefined();
}

Napi::Value GetRuntimeInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);

  Napi::Object runtimeInfo = Napi::Object::New(env);
  runtimeInfo.Set("loaded", Napi::Boolean::New(env, state.runtimeLoaded));
  runtimeInfo.Set("asyncVideoSend", Napi::Boolean::New(env, state.symbols.sendVideoAsyncV2 != nullptr));
  runtimeInfo.Set("audioSend", Napi::Boolean::New(env, state.symbols.sendAudioV2 != nullptr));
  if (state.loadedRuntimePath.empty()) {
    runtimeInfo.Set("path", env.Null());
  } else {
    runtimeInfo.Set("path", Napi::String::New(env, state.loadedRuntimePath));
  }
  return runtimeInfo;
}

void CleanupHook() {
  auto& state = State();
  std::lock_guard<std::mutex> guard(state.mutex);
  ShutdownRuntimeUnlocked(state);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  env.AddCleanupHook(CleanupHook);
  exports.Set("initializeSender", Napi::Function::New(env, InitializeSender));
  exports.Set("sendBgraFrame", Napi::Function::New(env, SendBgraFrame));
  exports.Set("sendRgbaFrame", Napi::Function::New(env, SendRgbaFrame));
  exports.Set("sendAudioFrame", Napi::Function::New(env, SendAudioFrame));
  exports.Set("getSenderConnections", Napi::Function::New(env, GetSenderConnections));
  exports.Set("getSenderTally", Napi::Function::New(env, GetSenderTally));
  exports.Set("destroySender", Napi::Function::New(env, DestroySender));
  exports.Set("getRuntimeInfo", Napi::Function::New(env, GetRuntimeInfo));
  return exports;
}

}  // namespace

NODE_API_MODULE(ndi_native, Init)
