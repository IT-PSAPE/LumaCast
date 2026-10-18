#include "zoom-sdk-bridge.h"

#include <napi.h>

#include <cmath>
#include <climits>
#include <memory>
#include <mutex>
#include <string>

namespace {

struct Event {
  std::string state;
  std::string message;
};

class EventDispatcher {
 public:
  explicit EventDispatcher(Napi::ThreadSafeFunction function)
      : function_(std::move(function)) {}

  void dispatch(const std::string& state, const std::string& message) {
    auto* event = new Event{state, message};
    if (function_.NonBlockingCall(event, [](Napi::Env env, Napi::Function callback,
                                           Event* value) {
          std::unique_ptr<Event> owned(value);
          Napi::Object payload = Napi::Object::New(env);
          payload.Set("state", Napi::String::New(env, owned->state));
          payload.Set("message", Napi::String::New(env, owned->message));
          callback.Call({payload});
        }) != napi_ok) {
      delete event;
    }
  }

  void release() { function_.Release(); }

 private:
  Napi::ThreadSafeFunction function_;
};

std::mutex g_bridgeMutex;
lumastream::zoom::SdkBridge* g_bridge = nullptr;
std::shared_ptr<EventDispatcher> g_dispatcher;

Napi::Value resultValue(Napi::Env env, const lumastream::zoom::Result& result) {
  Napi::Object value = Napi::Object::New(env);
  value.Set("ok", Napi::Boolean::New(env, result.ok));
  value.Set("message", Napi::String::New(env, result.message));
  return value;
}

bool readUnsigned(const Napi::Value& value, unsigned int* output) {
  if (!value.IsNumber()) return false;
  const double number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number < 1 || number > UINT_MAX ||
      std::floor(number) != number) {
    return false;
  }
  *output = static_cast<unsigned int>(number);
  return true;
}

Napi::Value initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "initialize(publicAppKey, eventCallback) expected")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string publicAppKey = info[0].As<Napi::String>().Utf8Value();
  if (publicAppKey.empty()) {
    Napi::TypeError::New(env, "A Zoom Public Client ID is required.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (g_bridge) {
    Napi::Error::New(env, "Zoom Meeting SDK addon is already initialized.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::ThreadSafeFunction function = Napi::ThreadSafeFunction::New(
      env, info[1].As<Napi::Function>(), "Zoom Meeting SDK events", 128, 1);
  auto dispatcher = std::make_shared<EventDispatcher>(std::move(function));
  auto* bridge = lumastream::zoom::createPlatformSdkBridge();
  if (!bridge) {
    dispatcher->release();
    Napi::Error::New(env, "Could not create the platform Zoom SDK bridge.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const auto result = bridge->initialize(
      publicAppKey, [weak = std::weak_ptr<EventDispatcher>(dispatcher)](
                        const std::string& state, const std::string& message) {
        if (const auto current = weak.lock()) current->dispatch(state, message);
      });
  if (!result.ok) {
    bridge->stop();
    lumastream::zoom::destroyPlatformSdkBridge(bridge);
    dispatcher->release();
    return resultValue(env, result);
  }

  g_bridge = bridge;
  g_dispatcher = std::move(dispatcher);
  return resultValue(env, result);
}

Napi::Value startMeeting(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 4 || !info[0].IsString() || !info[1].IsString() ||
      !info[2].IsString() || !info[3].IsString()) {
    Napi::TypeError::New(
        env, "startMeeting(meetingNumber, zak, zoomUserId, displayName) expected")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (!g_bridge) {
    Napi::Error::New(env, "Zoom Meeting SDK addon is not initialized.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return resultValue(env, g_bridge->startMeeting(
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::String>().Utf8Value(),
      info[2].As<Napi::String>().Utf8Value(),
      info[3].As<Napi::String>().Utf8Value()));
}

Napi::Value startProductionStudio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  unsigned int width, height;
  if (info.Length() != 2 || !readUnsigned(info[0], &width) ||
      !readUnsigned(info[1], &height) || width % 2 || height % 2) {
    Napi::TypeError::New(env, "startProductionStudio requires positive even width and height.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (!g_bridge) {
    Napi::Error::New(env, "Zoom Meeting SDK addon is not initialized.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return resultValue(env, g_bridge->startProductionStudio(width, height));
}

Napi::Value sendVideoFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  unsigned int width, height;
  if (info.Length() != 3 || !info[0].IsBuffer() ||
      !readUnsigned(info[1], &width) || !readUnsigned(info[2], &height) ||
      width % 2 || height % 2 ||
      static_cast<uint64_t>(width) * height > UINT64_MAX / 3) {
    Napi::TypeError::New(env, "sendVideoFrame requires an I420 Buffer and positive even dimensions.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  const uint64_t expected = static_cast<uint64_t>(width) * height * 3 / 2;
  if (buffer.Length() != expected) {
    Napi::RangeError::New(env, "I420 frame length must equal width * height * 1.5.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (!g_bridge) {
    Napi::Error::New(env, "Zoom Meeting SDK addon is not initialized.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return resultValue(env, g_bridge->sendVideoFrame(
      buffer.Data(), buffer.Length(), width, height));
}

Napi::Value sendAudioFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  unsigned int sampleRate, channels;
  if (info.Length() != 3 || !info[0].IsBuffer() ||
      !readUnsigned(info[1], &sampleRate) || !readUnsigned(info[2], &channels) ||
      (sampleRate != 32000 && sampleRate != 48000) ||
      (channels != 1 && channels != 2)) {
    Napi::TypeError::New(env, "sendAudioFrame requires a 32/48 kHz PCM Buffer and 1 or 2 channels.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() == 0 || buffer.Length() % 2 != 0) {
    Napi::RangeError::New(env, "PCM audio must contain complete 16-bit samples.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (!g_bridge) {
    Napi::Error::New(env, "Zoom Meeting SDK addon is not initialized.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return resultValue(env, g_bridge->sendAudioFrame(
      buffer.Data(), buffer.Length(), sampleRate, channels));
}

Napi::Value stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (g_bridge) {
    g_bridge->stop();
    lumastream::zoom::destroyPlatformSdkBridge(g_bridge);
    g_bridge = nullptr;
  }
  if (g_dispatcher) {
    g_dispatcher->release();
    g_dispatcher.reset();
  }
  return env.Undefined();
}

Napi::Object initializeAddon(Napi::Env env, Napi::Object exports) {
  exports.Set("initialize", Napi::Function::New(env, initialize));
  exports.Set("startMeeting", Napi::Function::New(env, startMeeting));
  exports.Set("startProductionStudio",
              Napi::Function::New(env, startProductionStudio));
  exports.Set("sendVideoFrame", Napi::Function::New(env, sendVideoFrame));
  exports.Set("sendAudioFrame", Napi::Function::New(env, sendAudioFrame));
  exports.Set("stop", Napi::Function::New(env, stop));
  return exports;
}

}  // namespace

NODE_API_MODULE(lumastream_zoom_sdk, initializeAddon)
