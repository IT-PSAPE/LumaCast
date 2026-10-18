#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

namespace lumastream::zoom {

struct Result {
  bool ok;
  std::string message;
};

using EventHandler = std::function<void(const std::string& state, const std::string& message)>;

class SdkBridge {
 public:
  virtual ~SdkBridge() = default;

  virtual Result initialize(const std::string& publicAppKey, EventHandler onEvent) = 0;
  virtual Result startMeeting(const std::string& meetingNumber, const std::string& zak, const std::string& zoomUserId, const std::string& displayName) = 0;
  virtual Result startProductionStudio(unsigned int width, unsigned int height) = 0;
  virtual Result sendVideoFrame(const std::uint8_t* data, std::size_t length, unsigned int width, unsigned int height) = 0;
  virtual Result sendAudioFrame(const std::uint8_t* data, std::size_t length, unsigned int sampleRate, unsigned int channels) = 0;
  virtual void stop() = 0;
};

SdkBridge* createPlatformSdkBridge();
void destroyPlatformSdkBridge(SdkBridge* bridge);

}  // namespace lumastream::zoom
