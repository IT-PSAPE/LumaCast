#include "zoom-sdk-bridge.h"

#include <napi.h>

#include <cmath>
#include <climits>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace {

struct DispatchState {
  std::mutex mutex;
  napi_threadsafe_function function = nullptr;
  bool closed = false;
};

struct Event {
  std::shared_ptr<DispatchState> dispatcher;
  std::string state;
  std::string message;
};

void callEvent(napi_env env, napi_value callback, void*, void* data) {
  // N-API also drains aborted queues with a null env/callback. Always own data.
  std::unique_ptr<Event> event(static_cast<Event*>(data));
  if (!event || !env || !callback) return;
  {
    std::lock_guard<std::mutex> lock(event->dispatcher->mutex);
    if (event->dispatcher->closed) return;
  }

  napi_value payload, state, message, receiver;
  if (napi_create_object(env, &payload) != napi_ok ||
      napi_create_string_utf8(env, event->state.data(), event->state.size(), &state) != napi_ok ||
      napi_create_string_utf8(env, event->message.data(), event->message.size(), &message) != napi_ok ||
      napi_set_named_property(env, payload, "state", state) != napi_ok ||
      napi_set_named_property(env, payload, "message", message) != napi_ok ||
      napi_get_undefined(env, &receiver) != napi_ok) return;
  napi_call_function(env, receiver, callback, 1, &payload, nullptr);
}

class EventDispatcher {
 public:
  EventDispatcher(Napi::Env env, Napi::Function callback)
      : state_(std::make_shared<DispatchState>()) {
    const napi_status status = napi_create_threadsafe_function(
        env, callback, nullptr, Napi::String::New(env, "Zoom Meeting SDK events"),
        128, 1, nullptr, nullptr, nullptr, callEvent, &state_->function);
    if (status != napi_ok) throw Napi::Error::New(env, "Could not create Zoom SDK event dispatcher.");
  }

  ~EventDispatcher() { close(); }

  void dispatch(const std::string& state, const std::string& message) {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->closed) return;
    auto event = std::make_unique<Event>(Event{state_, state, message});
    const auto status = napi_call_threadsafe_function(
        state_->function, event.get(), napi_tsfn_nonblocking);
    if (status == napi_ok) {
      event.release();
    } else if (status == napi_closing) {
      // Runtime shutdown consumes our acquisition; no further call or release.
      state_->closed = true;
      state_->function = nullptr;
    }
  }

  void close() noexcept {
    napi_threadsafe_function function;
    {
      std::lock_guard<std::mutex> lock(state_->mutex);
      if (state_->closed) return;
      state_->closed = true;
      function = state_->function;
      state_->function = nullptr;
    }
    // Enqueue and invalidation are serialized; only this call releases our thread.
    napi_release_threadsafe_function(function, napi_tsfn_abort);
  }

 private:
  std::shared_ptr<DispatchState> state_;
};

struct Session {
  lumastream::zoom::SdkBridge* bridge = nullptr;
  std::shared_ptr<EventDispatcher> dispatcher;

  ~Session() noexcept {
    // Platform stop may emit events, including during environment cleanup.
    if (dispatcher) dispatcher->close();
    if (bridge) {
      try { bridge->stop(); } catch (...) {}
      try { lumastream::zoom::destroyPlatformSdkBridge(bridge); } catch (...) {}
    }
  }
};

enum class Phase { idle, initializing, ready, stopping };
struct Environment { napi_env env; };
std::mutex g_bridgeMutex;
napi_env g_owner = nullptr;
Phase g_phase = Phase::idle;
std::unique_ptr<Session> g_session;
std::unordered_map<napi_env, Environment*> g_environments;

// This guard outlives the local Session, retaining ownership through destruction.
struct Reservation {
  napi_env owner;
  bool active = true;
  ~Reservation() {
    if (!active) return;
    std::lock_guard<std::mutex> lock(g_bridgeMutex);
    if (g_owner == owner) {
      g_owner = nullptr;
      g_phase = Phase::idle;
    }
  }
};

void stopOwnedSession(napi_env env) noexcept {
  std::unique_ptr<Session> session;
  {
    std::lock_guard<std::mutex> lock(g_bridgeMutex);
    if (g_owner != env) return;
    g_phase = Phase::stopping;
    session = std::move(g_session);
  }
  // No global lock across platform calls (macOS may dispatch to its main queue).
  Reservation reservation{env};
  session.reset();
}

void cleanupEnvironment(void* data) noexcept {
  std::unique_ptr<Environment> environment(static_cast<Environment*>(data));
  stopOwnedSession(environment->env);
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  g_environments.erase(environment->env);
}

void registerEnvironment(Napi::Env env) {
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (g_environments.count(env)) return;
  auto environment = std::make_unique<Environment>(Environment{env});
  g_environments.emplace(env, environment.get());
  if (napi_add_env_cleanup_hook(env, cleanupEnvironment, environment.get()) != napi_ok) {
    g_environments.erase(env);
    throw Napi::Error::New(env, "Could not register Zoom SDK environment cleanup.");
  }
  environment.release();
}

lumastream::zoom::SdkBridge* ownedBridge(Napi::Env env) {
  std::lock_guard<std::mutex> lock(g_bridgeMutex);
  if (g_owner && g_owner != env)
    throw Napi::Error::New(env, "Zoom Meeting SDK addon belongs to another JavaScript environment.");
  if (!g_session || g_phase != Phase::ready)
    throw Napi::Error::New(env, "Zoom Meeting SDK addon is not initialized.");
  // Only the owning JS environment can call/stop this synchronous bridge.
  return g_session->bridge;
}

template <typename Function>
auto sdkCall(Napi::Env env, Function&& function) -> decltype(function()) {
  try {
    return function();
  } catch (const Napi::Error&) {
    throw;
  } catch (const std::exception& error) {
    throw Napi::Error::New(env, error.what());
  } catch (...) {
    throw Napi::Error::New(env, "Zoom Meeting SDK operation failed.");
  }
}

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

  {
    std::lock_guard<std::mutex> lock(g_bridgeMutex);
    if (g_owner && g_owner != env)
      throw Napi::Error::New(env, "Zoom Meeting SDK addon belongs to another JavaScript environment.");
    if (g_owner)
      throw Napi::Error::New(env, "Zoom Meeting SDK addon is already initialized.");
    g_owner = env;
    g_phase = Phase::initializing;
  }

  Reservation reservation{env};
  return sdkCall(env, [&]() -> Napi::Value {
    auto session = std::make_unique<Session>();
    session->dispatcher = std::make_shared<EventDispatcher>(env, info[1].As<Napi::Function>());
    session->bridge = lumastream::zoom::createPlatformSdkBridge();
    if (!session->bridge)
      throw Napi::Error::New(env, "Could not create the platform Zoom SDK bridge.");

    const auto result = session->bridge->initialize(
        publicAppKey, [weak = std::weak_ptr<EventDispatcher>(session->dispatcher)](
                          const std::string& state, const std::string& message) {
          if (const auto current = weak.lock()) current->dispatch(state, message);
        });
    Napi::Value value = resultValue(env, result);
    if (result.ok) {
      std::lock_guard<std::mutex> lock(g_bridgeMutex);
      g_session = std::move(session);
      g_phase = Phase::ready;
      reservation.active = false;
    }
    return value;
  });
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
  auto* bridge = ownedBridge(env);
  return resultValue(env, sdkCall(env, [&] { return bridge->startMeeting(
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::String>().Utf8Value(),
      info[2].As<Napi::String>().Utf8Value(),
      info[3].As<Napi::String>().Utf8Value()); }));
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
  auto* bridge = ownedBridge(env);
  return resultValue(env, sdkCall(env, [&] { return bridge->startProductionStudio(width, height); }));
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
  auto* bridge = ownedBridge(env);
  return resultValue(env, sdkCall(env, [&] { return bridge->sendVideoFrame(
      buffer.Data(), buffer.Length(), width, height); }));
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
  if (buffer.Length() == 0 || buffer.Length() % (channels * 2) != 0) {
    Napi::RangeError::New(env, "PCM audio must contain complete 16-bit channel frames.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* bridge = ownedBridge(env);
  return resultValue(env, sdkCall(env, [&] { return bridge->sendAudioFrame(
      buffer.Data(), buffer.Length(), sampleRate, channels); }));
}

Napi::Value stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  {
    std::lock_guard<std::mutex> lock(g_bridgeMutex);
    if (g_owner && g_owner != env)
      throw Napi::Error::New(env, "Zoom Meeting SDK addon belongs to another JavaScript environment.");
    if (g_owner && g_phase != Phase::ready)
      throw Napi::Error::New(env, "Zoom Meeting SDK operation is in progress.");
  }
  stopOwnedSession(env);
  return env.Undefined();
}

Napi::Object initializeAddon(Napi::Env env, Napi::Object exports) {
  registerEnvironment(env);
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
