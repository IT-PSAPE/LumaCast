#include <napi.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {
napi_status observeEnqueue(napi_threadsafe_function function, void* data,
                           napi_threadsafe_function_call_mode mode);
napi_status observeRelease(napi_threadsafe_function function,
                           napi_threadsafe_function_release_mode mode);
}

// Compile the production addon unchanged apart from its module initializer.
// These two delegates only observe queue ownership and releases, then call N-API.
#undef NODE_API_MODULE
#define NODE_API_MODULE(name, initializer)
#define napi_call_threadsafe_function observeEnqueue
#define napi_release_threadsafe_function observeRelease
#include "../../../../../apps/stream/native/zoom/zoom-sdk-addon.cc"
#undef napi_call_threadsafe_function
#undef napi_release_threadsafe_function
#undef NODE_API_MODULE

namespace {
std::mutex observationsMutex;
std::vector<std::weak_ptr<DispatchState>> observedStates;
std::vector<lumastream::zoom::EventHandler> savedHandlers;
std::string fakeMode;
std::atomic<unsigned> created{0}, destroyed{0}, stopped{0}, calls{0};
std::atomic<unsigned> attempts{0}, enqueued{0}, dropped{0}, aborts{0}, closing{0};
std::atomic<unsigned> lockedCalls{0}, missingReservation{0};
std::atomic<bool> blockDestroy{false}, destroying{false};

napi_status observeEnqueue(napi_threadsafe_function function, void* data,
                           napi_threadsafe_function_call_mode mode) {
  auto* event = static_cast<Event*>(data);
  {
    std::lock_guard<std::mutex> lock(observationsMutex);
    const auto& state = event->dispatcher;
    bool known = false;
    for (const auto& weak : observedStates)
      if (!weak.owner_before(state) && !state.owner_before(weak)) known = true;
    if (!known) observedStates.emplace_back(state);
  }
  ++attempts;
  const auto result = napi_call_threadsafe_function(function, data, mode);
  if (result == napi_ok) ++enqueued;
  else ++dropped;
  if (result == napi_closing) ++closing;
  return result;
}

napi_status observeRelease(napi_threadsafe_function function,
                           napi_threadsafe_function_release_mode mode) {
  if (mode == napi_tsfn_abort) ++aborts;
  return napi_release_threadsafe_function(function, mode);
}

void observeNativeCall() {
  // A second thread proves the addon lock is free even for same-env SDK calls.
  std::thread probe([] {
    if (!g_bridgeMutex.try_lock()) {
      ++lockedCalls;
      return;
    }
    if (!g_owner) ++missingReservation;
    g_bridgeMutex.unlock();
  });
  probe.join();
  ++calls;
}

class FakeSdkBridge final : public lumastream::zoom::SdkBridge {
 public:
  explicit FakeSdkBridge(std::string mode) : mode_(std::move(mode)) { ++created; }
  ~FakeSdkBridge() override {
    if (emitter_.joinable()) emitter_.join();
    observeNativeCall();
    destroying = true;
    while (blockDestroy) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    destroying = false;
    ++destroyed;
  }

  lumastream::zoom::Result initialize(const std::string& key,
                                     lumastream::zoom::EventHandler handler) override {
    observeNativeCall();
    handler_ = std::move(handler);
    {
      std::lock_guard<std::mutex> lock(observationsMutex);
      savedHandlers.push_back(handler_);
    }
    handler_("authenticated", "fake " + key);
    if (mode_ == "initialize-throw") throw std::runtime_error("fake initialize exception");
    return {mode_ != "initialize-fail", mode_ == "initialize-fail" ? "fake initialize failure" : "initialized"};
  }

  lumastream::zoom::Result startMeeting(const std::string& number, const std::string& zak,
                                       const std::string& user, const std::string& name) override {
    observeNativeCall();
    if (number == "throw") throw std::runtime_error("fake meeting exception");
    if (number == "emit-thread") {
      emitter_ = std::thread([handler = handler_] {
        for (unsigned i = 0; i < 20000; ++i) handler("thread", "event");
      });
    }
    return {true, number + ":" + zak + ":" + user + ":" + name};
  }

  lumastream::zoom::Result startProductionStudio(unsigned width, unsigned height) override {
    observeNativeCall();
    return {true, std::to_string(width) + "x" + std::to_string(height)};
  }

  lumastream::zoom::Result sendVideoFrame(const uint8_t*, size_t length,
                                         unsigned width, unsigned height) override {
    observeNativeCall();
    return {true, std::to_string(length) + ":" + std::to_string(width) + ":" + std::to_string(height)};
  }

  lumastream::zoom::Result sendAudioFrame(const uint8_t*, size_t length,
                                         unsigned rate, unsigned channels) override {
    observeNativeCall();
    return {true, std::to_string(length) + ":" + std::to_string(rate) + ":" + std::to_string(channels)};
  }

  void stop() override {
    observeNativeCall();
    ++stopped;
    if (handler_) handler_("stopped", "stop emits before native destruction");
    if (mode_ == "stop-throw") throw std::runtime_error("fake stop exception");
  }

 private:
  std::string mode_;
  lumastream::zoom::EventHandler handler_;
  std::thread emitter_;
};

Napi::Object snapshot(Napi::Env env) {
  Napi::Object value = Napi::Object::New(env);
#define SNAPSHOT(name) value.Set(#name, Napi::Number::New(env, name.load()))
  SNAPSHOT(created); SNAPSHOT(destroyed); SNAPSHOT(stopped); SNAPSHOT(calls);
  SNAPSHOT(attempts); SNAPSHOT(enqueued); SNAPSHOT(dropped); SNAPSHOT(aborts); SNAPSHOT(closing);
  SNAPSHOT(lockedCalls); SNAPSHOT(missingReservation);
#undef SNAPSHOT
  value.Set("destroying", Napi::Boolean::New(env, destroying));
  unsigned liveStates = 0;
  {
    std::lock_guard<std::mutex> lock(observationsMutex);
    for (const auto& weak : observedStates) if (!weak.expired()) ++liveStates;
  }
  value.Set("liveStates", Napi::Number::New(env, liveStates));
  {
    std::lock_guard<std::mutex> lock(g_bridgeMutex);
    value.Set("owned", Napi::Boolean::New(env, g_owner != nullptr));
    value.Set("environments", Napi::Number::New(env, g_environments.size()));
  }
  return value;
}

Napi::Object initializeFixture(Napi::Env env, Napi::Object exports) {
  initializeAddon(env, exports);
  exports.Set("snapshot", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    return snapshot(info.Env());
  }));
  exports.Set("mode", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(observationsMutex);
    fakeMode = info[0].As<Napi::String>().Utf8Value();
  }));
  exports.Set("emit", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    std::vector<lumastream::zoom::EventHandler> handlers;
    {
      std::lock_guard<std::mutex> lock(observationsMutex);
      handlers = savedHandlers;
    }
    const unsigned count = info[0].As<Napi::Number>().Uint32Value();
    for (unsigned i = 0; i < count; ++i)
      for (const auto& handler : handlers) handler("event", "queued");
  }));
  exports.Set("blockDestroy", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    blockDestroy = info[0].As<Napi::Boolean>().Value();
  }));
  exports.Set("registerAgain", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    registerEnvironment(info.Env());
  }));
  exports.Set("forceClosing", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    std::shared_ptr<DispatchState> state;
    {
      std::lock_guard<std::mutex> lock(observationsMutex);
      if (!observedStates.empty()) state = observedStates.back().lock();
    }
    if (!state) throw Napi::Error::New(info.Env(), "No active event dispatcher.");
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->closed) throw Napi::Error::New(info.Env(), "Event dispatcher is already closed.");
    // Put real N-API into its runtime-closing path while retaining the addon's
    // acquisition. Its next enqueue returns napi_closing and consumes that hold.
    if (napi_acquire_threadsafe_function(state->function) != napi_ok ||
        napi_release_threadsafe_function(state->function, napi_tsfn_abort) != napi_ok)
      throw Napi::Error::New(info.Env(), "Could not close the event dispatcher.");
  }));
  exports.Set("nullDeliveryReleases", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    auto state = std::make_shared<DispatchState>();
    std::weak_ptr<DispatchState> weak = state;
    auto* event = new Event{state, "state", "message"};
    state.reset();
    callEvent(nullptr, nullptr, nullptr, event);
    return Napi::Boolean::New(info.Env(), weak.expired());
  }));
  return exports;
}
}  // namespace

namespace lumastream::zoom {
SdkBridge* createPlatformSdkBridge() {
  observeNativeCall();
  std::lock_guard<std::mutex> lock(observationsMutex);
  if (fakeMode == "create-null") return nullptr;
  if (fakeMode == "create-throw") throw std::runtime_error("fake create exception");
  return new FakeSdkBridge(fakeMode);
}
void destroyPlatformSdkBridge(SdkBridge* bridge) { delete bridge; }
}  // namespace lumastream::zoom

NAPI_MODULE_INIT() { return Napi::RegisterModule(env, exports, initializeFixture); }
