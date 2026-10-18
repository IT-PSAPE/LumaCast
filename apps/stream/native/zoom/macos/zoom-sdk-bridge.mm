#import <Cocoa/Cocoa.h>
#import <ZoomSDK/ZoomSDK.h>

#include "../zoom-sdk-bridge.h"

#include <limits>
#include <mutex>
#include <string>

using lumastream::zoom::EventHandler;
using lumastream::zoom::Result;

Result failure(const std::string& message) { return {false, message}; }
Result success(const std::string& message) { return {true, message}; }

NSString* toNSString(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}

template <typename Function>
auto onMainThread(Function&& function) -> decltype(function()) {
  using ReturnType = decltype(function());
  if ([NSThread isMainThread]) return function();
  __block ReturnType result;
  dispatch_sync(dispatch_get_main_queue(), ^{ result = function(); });
  return result;
}

class MacSdkBridge;

@interface ZoomSdkCallbacks : NSObject <ZoomSDKAuthDelegate,
                                         ZoomSDKMeetingServiceDelegate,
                                         ZoomSDKMeetingProductionStudioControllerDelegate>
@property(nonatomic, assign) MacSdkBridge* bridge;
@end

class MacSdkBridge final : public lumastream::zoom::SdkBridge {
 public:
  MacSdkBridge() : callbacks_([[ZoomSdkCallbacks alloc] init]) {
    callbacks_.bridge = this;
  }

  ~MacSdkBridge() override { stop(); }

  Result initialize(const std::string& publicAppKey, EventHandler onEvent) override {
    if (publicAppKey.empty()) return failure("Zoom Public Client ID is required.");

    return onMainThread([&]() -> Result {
      callbacks_.bridge = this;
      {
        std::lock_guard<std::mutex> lock(eventMutex_);
        eventHandler_ = std::move(onEvent);
      }

      sdk_ = [ZoomSDK sharedSDK];
      if (!sdk_) return failure("Zoom Meeting SDK could not be loaded.");

      if (!initialized_) {
        ZoomSDKInitParams* params = [[ZoomSDKInitParams alloc] init];
        // The app hosts its own controls; do not open Zoom's standalone meeting UI.
        params.needCustomizedUI = YES;
        params.enableLog = NO;
        params.zoomDomain = @"zoom.us";
        ZoomSDKError initResult = [sdk_ initSDKWithParams:params];
        if (initResult != ZoomSDKError_Success) {
          return failure("Zoom SDK initialization failed (" + std::to_string(initResult) + ").");
        }
        initialized_ = true;
      }

      authService_ = [sdk_ getAuthService];
      meetingService_ = [sdk_ getMeetingService];
      if (!authService_ || !meetingService_) return failure("Zoom SDK services are unavailable.");

      authService_.delegate = callbacks_;
      meetingService_.delegate = callbacks_;

      ZoomSDKAuthContext* authContext = [[ZoomSDKAuthContext alloc] init];
      authContext.publicAppKey = toNSString(publicAppKey);
      ZoomSDKError authResult = [authService_ sdkAuth:authContext];
      if (authResult != ZoomSDKError_Success) {
        return failure("Zoom SDK authorization could not be started (" + std::to_string(authResult) + ").");
      }
      return success("Zoom SDK authorization started.");
    });
  }

  Result startMeeting(const std::string& meetingNumber, const std::string& zak,
                      const std::string& zoomUserId, const std::string& displayName) override {
    if (meetingNumber.empty() || zak.empty() || displayName.empty()) {
      return failure("Meeting number, ZAK token, and display name are required.");
    }
    long long number = 0;
    try {
      std::size_t parsed = 0;
      number = std::stoll(meetingNumber, &parsed);
      if (parsed != meetingNumber.size() || number <= 0) return failure("Meeting number is invalid.");
    } catch (...) {
      return failure("Meeting number is invalid.");
    }

    (void)zoomUserId;  // The ZAK authenticates the account identity used by startMeetingWithZAK.
    return onMainThread([&]() -> Result {
      if (!authService_ || !authService_.isAuthorized) {
        return failure("Zoom SDK is not authorized yet.");
      }
      if (!meetingService_) return failure("Zoom Meeting Service is unavailable.");

      ZoomSDKStartMeetingUseZakElements* options = [[ZoomSDKStartMeetingUseZakElements alloc] init];
      options.zak = toNSString(zak);
      options.displayName = toNSString(displayName);
      options.userType = SDKUserType_APIUser;
      options.meetingNumber = number;
      options.isDirectShare = NO;
      options.displayID = 0;
      options.isNoVideo = YES;
      options.isNoAudio = YES;
      ZoomSDKError result = [meetingService_ startMeetingWithZAK:options];
      if (result != ZoomSDKError_Success) {
        return failure("Zoom meeting start failed (" + std::to_string(result) + ").");
      }
      emit("meeting-connecting", "Joining selected Zoom meeting.");
      return success("Zoom meeting start requested.");
    });
  }

  Result startProductionStudio(unsigned int width, unsigned int height) override {
    if (width == 0 || height == 0 || (width & 1U) || (height & 1U)) {
      return failure("Production Studio requires positive, even video dimensions.");
    }
    if (static_cast<std::uint64_t>(width) * height * 3 / 2 > std::numeric_limits<unsigned int>::max()) {
      return failure("Video dimensions exceed the Zoom SDK frame limit.");
    }

    return onMainThread([&]() -> Result {
      if (!meetingService_ || [meetingService_ getMeetingStatus] != ZoomSDKMeetingStatus_InMeeting) {
        return failure("Join the Zoom meeting before starting Production Studio.");
      }
      studioController_ = [meetingService_ getMeetingProductionStudioController];
      if (!studioController_ || !studioController_.isSupportPSMode) {
        return failure("Production Studio is not available for this meeting or account.");
      }
      if (!studioController_.canStartPSMode) {
        return failure("The Zoom account must be meeting host or co-host to start Production Studio.");
      }

      studioController_.delegate = callbacks_;
      {
        std::lock_guard<std::mutex> lock(studioMutex_);
        productionStarted_ = false;
        senderReady_ = false;
      }
      ZoomSDKPSVideoSourceCapability* capability = [[ZoomSDKPSVideoSourceCapability alloc] init];
      capability.width = static_cast<int>(width);
      capability.height = static_cast<int>(height);
      capability.format = ZoomSDKFrameDataFormat_I420_FULL;
      ZoomSDKError result = [studioController_ startPSMode:capability];
      if (result != ZoomSDKError_Success) {
        return failure("Zoom Production Studio start failed (" + std::to_string(result) + ").");
      }
      expectedWidth_ = width;
      expectedHeight_ = height;
      emit("production-studio-starting", "Starting Zoom Production Studio.");
      return success("Zoom Production Studio start requested.");
    });
  }

  Result sendVideoFrame(const std::uint8_t* data, std::size_t length,
                        unsigned int width, unsigned int height) override {
    if (!data) return failure("Video frame data is empty.");
    const std::uint64_t expectedLength = static_cast<std::uint64_t>(width) * height * 3 / 2;
    if (width == 0 || height == 0 || (width & 1U) || (height & 1U) ||
        expectedLength != length || length > std::numeric_limits<unsigned int>::max()) {
      return failure("Zoom requires tightly packed I420 video matching the configured dimensions.");
    }
    ZoomSDKPSSender* sender = nil;
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender = sender_;
    }
    if (!sender) return failure("Zoom Production Studio is not ready to receive video.");
    if (width != expectedWidth_ || height != expectedHeight_) {
      return failure("Video frame dimensions do not match the Production Studio capability.");
    }
    // The SDK consumes the buffer synchronously; retain the callback-owned sender locally.
    ZoomSDKError result = [sender sendVideoFrame:reinterpret_cast<char*>(const_cast<std::uint8_t*>(data))
                                           width:width
                                          height:height
                                      frameLength:static_cast<unsigned int>(length)
                                          format:ZoomSDKFrameDataFormat_I420_FULL];
    return result == ZoomSDKError_Success
               ? success("Video frame sent.")
               : failure("Zoom rejected the video frame (" + std::to_string(result) + ").");
  }

  Result sendAudioFrame(const std::uint8_t* data, std::size_t length,
                        unsigned int sampleRate, unsigned int channels) override {
    if (!data || length == 0 || (length & 1U) || length > std::numeric_limits<unsigned int>::max()) {
      return failure("Zoom audio must be non-empty, 16-bit PCM with an even byte length.");
    }
    if ((sampleRate != 32000 && sampleRate != 48000) || (channels != 1 && channels != 2)) {
      return failure("Zoom Production Studio accepts 32 kHz or 48 kHz mono/stereo PCM.");
    }
    ZoomSDKPSSender* sender = nil;
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender = sender_;
    }
    if (!sender) return failure("Zoom Production Studio is not ready to receive audio.");
    ZoomSDKError result = [sender sendAudio:reinterpret_cast<char*>(const_cast<std::uint8_t*>(data))
                                 dataLength:static_cast<unsigned int>(length)
                                 sampleRate:static_cast<int>(sampleRate)
                                    channel:(channels == 1 ? ZoomSDKAudioChannel_Mono : ZoomSDKAudioChannel_Stereo)];
    return result == ZoomSDKError_Success
               ? success("Audio frame sent.")
               : failure("Zoom rejected the audio frame (" + std::to_string(result) + ").");
  }

  void stop() override {
    onMainThread([&]() {
      if (studioController_) {
        studioController_.delegate = nil;
        if (studioController_.isPSModeStarted) [studioController_ stopPSMode];
        studioController_ = nil;
      }
      {
        std::lock_guard<std::mutex> lock(senderMutex_);
        sender_ = nil;
      }
      if (meetingService_) {
        meetingService_.delegate = nil;
        ZoomSDKMeetingStatus status = [meetingService_ getMeetingStatus];
        if (status != ZoomSDKMeetingStatus_Idle && status != ZoomSDKMeetingStatus_Ended) {
          [meetingService_ leaveMeetingWithCmd:LeaveMeetingCmd_Leave];
        }
      }
      if (authService_) authService_.delegate = nil;
      if (initialized_ && sdk_) [sdk_ unInitSDK];
      initialized_ = false;
      sdk_ = nil;
      authService_ = nil;
      meetingService_ = nil;
      callbacks_.bridge = nullptr;
      emit("stopped", "Zoom output stopped.");
      return true;
    });
  }

  void authResult(ZoomSDKAuthError result) {
    emit(result == ZoomSDKAuthError_Success ? "authenticated" : "error",
         result == ZoomSDKAuthError_Success
             ? "Zoom Meeting SDK authorized."
             : "Zoom Meeting SDK authorization failed (" + std::to_string(result) + ").");
  }

  void meetingStatus(ZoomSDKMeetingStatus status, ZoomSDKMeetingError error) {
    switch (status) {
      case ZoomSDKMeetingStatus_Connecting: emit("meeting-connecting", "Connecting to Zoom meeting."); break;
      case ZoomSDKMeetingStatus_InMeeting: emit("meeting", "Joined Zoom meeting."); break;
      case ZoomSDKMeetingStatus_AudioReady: emit("meeting", "Zoom meeting audio is ready."); break;
      case ZoomSDKMeetingStatus_WaitingForHost: emit("meeting-connecting", "Waiting for the Zoom meeting host."); break;
      case ZoomSDKMeetingStatus_InWaitingRoom: emit("meeting-connecting", "Waiting in the Zoom meeting room."); break;
      case ZoomSDKMeetingStatus_Failed:
        emit("error", "Zoom meeting failed (" + std::to_string(error) + ").");
        break;
      case ZoomSDKMeetingStatus_Ended:
      case ZoomSDKMeetingStatus_Idle: emit("meeting-ended", "Zoom meeting ended."); break;
      default: break;
    }
  }

  void studioStarted(bool started) {
    if (!started) {
      emit("error", "Zoom Production Studio failed to start.");
      return;
    }
    bool ready = false;
    {
      std::lock_guard<std::mutex> lock(studioMutex_);
      productionStarted_ = true;
      ready = senderReady_;
    }
    if (ready) emit("production-studio", "Zoom Production Studio is sending.");
    else emit("production-studio-starting", "Zoom Production Studio is active; waiting for sender.");
  }

  void senderStarted(ZoomSDKPSSender* sender) {
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender_ = sender;
    }
    if (!sender) {
      emit("error", "Zoom sender is unavailable.");
      return;
    }
    bool ready = false;
    {
      std::lock_guard<std::mutex> lock(studioMutex_);
      senderReady_ = true;
      ready = productionStarted_;
    }
    if (ready) emit("production-studio", "Zoom Production Studio is sending.");
    else emit("production-studio-starting", "Waiting for Zoom Production Studio to start.");
  }

  void senderStopped() {
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender_ = nil;
    }
    {
      std::lock_guard<std::mutex> lock(studioMutex_);
      senderReady_ = false;
      productionStarted_ = false;
    }
    emit("meeting", "Zoom Production Studio stopped sending.");
  }

 private:
  void emit(const std::string& state, const std::string& message) {
    EventHandler handler;
    {
      std::lock_guard<std::mutex> lock(eventMutex_);
      handler = eventHandler_;
    }
    if (handler) handler(state, message);
  }

  __strong ZoomSDK* sdk_ = nil;
  __strong ZoomSDKAuthService* authService_ = nil;
  __strong ZoomSDKMeetingService* meetingService_ = nil;
  __strong ZoomSDKMeetingProductionStudioController* studioController_ = nil;
  __strong ZoomSdkCallbacks* callbacks_ = nil;
  __strong ZoomSDKPSSender* sender_ = nil;
  std::mutex eventMutex_;
  std::mutex senderMutex_;
  std::mutex studioMutex_;
  EventHandler eventHandler_;
  unsigned int expectedWidth_ = 0;
  unsigned int expectedHeight_ = 0;
  bool productionStarted_ = false;
  bool senderReady_ = false;
  bool initialized_ = false;
};

@implementation ZoomSdkCallbacks
- (void)onZoomSDKAuthReturn:(ZoomSDKAuthError)returnValue {
  if (self.bridge) self.bridge->authResult(returnValue);
}
- (void)onZoomAuthIdentityExpired {
  if (self.bridge) self.bridge->authResult(ZoomSDKAuthError_Timeout);
}
- (void)onMeetingStatusChange:(ZoomSDKMeetingStatus)state
                 meetingError:(ZoomSDKMeetingError)error
                    EndReason:(EndMeetingReason)reason {
  (void)reason;
  if (self.bridge) self.bridge->meetingStatus(state, error);
}
- (void)onStartPSModeResult:(BOOL)success {
  if (self.bridge) self.bridge->studioStarted(success == YES);
}
- (void)onStartSend:(ZoomSDKPSSender*)sender {
  if (self.bridge) self.bridge->senderStarted(sender);
}
- (void)onStopSend {
  if (self.bridge) self.bridge->senderStopped();
}
@end

namespace lumastream::zoom {

SdkBridge* createPlatformSdkBridge() { return new MacSdkBridge(); }
void destroyPlatformSdkBridge(SdkBridge* bridge) { delete bridge; }

}  // namespace lumastream::zoom
