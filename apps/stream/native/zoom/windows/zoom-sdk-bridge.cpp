#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include "zoom-sdk-bridge.h"

#include <zoom_sdk.h>
#include <auth_service_interface.h>
#include <meeting_service_interface.h>
#include <meeting_service_components/meeting_production_studio_ctrl_interface.h>

#include <atomic>
#include <limits>
#include <mutex>
#include <string>
#include <utility>

namespace lumastream::zoom {
namespace {

std::wstring toWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                       static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<size_t>(size), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                          static_cast<int>(value.size()), result.data(), size) != size) {
    return {};
  }
  return result;
}

Result sdkError(const char* operation, ZOOMSDK::SDKError error) {
  if (error == ZOOMSDK::SDKERR_SUCCESS) return {true, {}};
  return {false, std::string(operation) + " failed (Zoom SDK error " +
                                 std::to_string(static_cast<int>(error)) + ")"};
}

}  // namespace

class WindowsSdkBridge final : public SdkBridge,
                               private ZOOMSDK::IAuthServiceEvent,
                               private ZOOMSDK::IMeetingServiceEvent,
                               private ZOOMSDK::IMeetingProductionStudioCtrlEvent {
 public:
  ~WindowsSdkBridge() override { stop(); }

  Result initialize(const std::string& publicAppKey, EventHandler onEvent) override {
    const std::wstring appKey = toWide(publicAppKey);
    if (appKey.empty()) return {false, "A valid Zoom Public Client ID is required."};

    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (initialized_) {
        eventHandler_ = std::move(onEvent);
        return {true, {}};
      }
      eventHandler_ = std::move(onEvent);
    }

    ZOOMSDK::InitParam initParam;
    initParam.strWebDomain = L"https://zoom.us";
    initParam.emLanguageID = ZOOMSDK::LANGUAGE_English;
    initParam.enableLogByDefault = false;
    initParam.enableGenerateDump = false;
    auto result = sdkError("Zoom SDK initialization", ZOOMSDK::InitSDK(initParam));
    if (!result.ok) return result;
    sdkInitialized_ = true;

    ZOOMSDK::IAuthService* auth = nullptr;
    result = sdkError("Zoom auth service creation", ZOOMSDK::CreateAuthService(&auth));
    if (!result.ok || auth == nullptr) {
      stop();
      return result.ok ? Result{false, "Zoom did not create an auth service."} : result;
    }
    authService_ = auth;
    result = sdkError("Zoom auth callback registration", authService_->SetEvent(this));
    if (!result.ok) {
      stop();
      return result;
    }

    ZOOMSDK::IMeetingService* meeting = nullptr;
    result = sdkError("Zoom meeting service creation", ZOOMSDK::CreateMeetingService(&meeting));
    if (!result.ok || meeting == nullptr) {
      stop();
      return result.ok ? Result{false, "Zoom did not create a meeting service."} : result;
    }
    meetingService_ = meeting;
    result = sdkError("Zoom meeting callback registration", meetingService_->SetEvent(this));
    if (!result.ok) {
      stop();
      return result;
    }

    ZOOMSDK::AuthContext context;
    context.publicAppKey = appKey.c_str();
    result = sdkError("Zoom public app authentication", authService_->SDKAuth(context));
    if (!result.ok) {
      stop();
      return result;
    }
    initialized_ = true;
    return {true, "Zoom SDK authentication started."};
  }

  Result startMeeting(const std::string& meetingNumber, const std::string& zak,
                      const std::string& zoomUserId, const std::string& displayName) override {
    if (!initialized_ || !authenticated_.load()) {
      return {false, "Zoom SDK authentication has not completed."};
    }
    if (meetingService_ == nullptr) return {false, "Zoom meeting service is unavailable."};

    unsigned long long parsedNumber = 0;
    try {
      size_t consumed = 0;
      parsedNumber = std::stoull(meetingNumber, &consumed);
      if (consumed != meetingNumber.size() || parsedNumber == 0) {
        return {false, "The Zoom meeting number is invalid."};
      }
    } catch (...) {
      return {false, "The Zoom meeting number is invalid."};
    }

    std::wstring wideZak = toWide(zak);
    std::wstring wideName = toWide(displayName);
    if (wideZak.empty() || wideName.empty()) {
      return {false, "A Zoom ZAK token and display name are required."};
    }
    // The Windows Meeting SDK accepts the ZAK in JoinParam4WithoutLogin::userZAK.
    // Its public join API has no user-ID field; Zoom resolves identity from that ZAK.
    (void)zoomUserId;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      zak_ = std::move(wideZak);
      displayName_ = std::move(wideName);
    }

    ZOOMSDK::JoinParam params;
    params.userType = ZOOMSDK::SDK_UT_WITHOUT_LOGIN;
    auto& user = params.param.withoutloginuserJoin;
    user.meetingNumber = static_cast<std::uint64_t>(parsedNumber);
    user.userName = displayName_.c_str();
    user.userZAK = zak_.c_str();
    user.isVideoOff = true;
    user.isAudioOff = true;
    user.isAudioRawDataStereo = true;
    user.eAudioRawdataSamplingRate = ZOOMSDK::AudioRawdataSamplingRate_48K;

    emit("meeting-connecting", "Joining the scheduled Zoom meeting.");
    return sdkError("Zoom meeting join", meetingService_->Join(params));
  }

  Result startProductionStudio(unsigned int width, unsigned int height) override {
    if (!inMeeting_.load()) return {false, "Join the Zoom meeting before starting Production Studio."};
    if (width == 0 || height == 0 || (width & 1U) || (height & 1U) ||
        width > static_cast<unsigned int>(std::numeric_limits<int>::max()) ||
        height > static_cast<unsigned int>(std::numeric_limits<int>::max())) {
      return {false, "Production Studio requires positive, even video dimensions."};
    }
    if (meetingService_ == nullptr) return {false, "Zoom meeting service is unavailable."};
    auto* controller = meetingService_->GetMeetingProductionStudioController();
    if (controller == nullptr) return {false, "Zoom Production Studio is unavailable in this meeting."};
    if (!controller->IsSupportPSMode()) return {false, "This Zoom meeting does not support Production Studio."};
    if (!controller->CanStartPSMode()) return {false, "The Zoom account must be host or co-host to start Production Studio."};

    auto result = sdkError("Zoom Production Studio callback registration", controller->SetEvent(this));
    if (!result.ok) return result;
    width_ = width;
    height_ = height;
    ZOOMSDK::PSVideoSourceCapability capability;
    capability.width = width;
    capability.height = height;
    capability.format = ZOOMSDK::FrameDataFormat_I420_FULL;
    emit("production-studio-starting", "Starting Zoom Production Studio.");
    result = sdkError("Zoom Production Studio start", controller->StartPSMode(capability));
    if (!result.ok) emit("error", result.message);
    return result;
  }

  Result sendVideoFrame(const std::uint8_t* data, std::size_t length,
                        unsigned int width, unsigned int height) override {
    if (data == nullptr || width != width_ || height != height_ || (width & 1U) || (height & 1U)) {
      return {false, "Zoom video frame does not match the configured I420 dimensions."};
    }
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    if (pixels > std::numeric_limits<std::size_t>::max() / 3U || length != pixels * 3U / 2U ||
        length > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
      return {false, "Zoom video frame must contain exactly one I420 frame."};
    }
    std::lock_guard<std::mutex> lock(senderMutex_);
    if (sender_ == nullptr) return {false, "Zoom Production Studio is not ready to receive video."};
    return sdkError("Zoom video frame send", sender_->sendVideoFrame(
        reinterpret_cast<char*>(const_cast<std::uint8_t*>(data)), static_cast<int>(width),
        static_cast<int>(height), static_cast<int>(length), ZOOMSDK::FrameDataFormat_I420_FULL));
  }

  Result sendAudioFrame(const std::uint8_t* data, std::size_t length,
                        unsigned int sampleRate, unsigned int channels) override {
    if (data == nullptr || length == 0 || (length & 1U) != 0 ||
        (sampleRate != 32000 && sampleRate != 48000) || (channels != 1 && channels != 2) ||
        length > std::numeric_limits<unsigned int>::max()) {
      return {false, "Zoom audio must be 16-bit PCM at 32 or 48 kHz with one or two channels."};
    }
    std::lock_guard<std::mutex> lock(senderMutex_);
    if (sender_ == nullptr) return {false, "Zoom Production Studio is not ready to receive audio."};
    const auto channel = channels == 1 ? ZOOMSDK::ZoomSDKAudioChannel_Mono
                                       : ZOOMSDK::ZoomSDKAudioChannel_Stereo;
    return sdkError("Zoom audio frame send", sender_->sendAudio(
        reinterpret_cast<char*>(const_cast<std::uint8_t*>(data)),
        static_cast<unsigned int>(length), static_cast<int>(sampleRate), channel));
  }

  void stop() override {
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender_ = nullptr;
    }
    if (meetingService_ != nullptr) {
      auto* controller = meetingService_->GetMeetingProductionStudioController();
      if (controller != nullptr && controller->IsPSModeStarted()) controller->StopPSMode();
      if (meetingService_->GetMeetingStatus() != ZOOMSDK::MEETING_STATUS_IDLE) {
        meetingService_->Leave(ZOOMSDK::LEAVE_MEETING);
      }
      meetingService_->SetEvent(nullptr);
      ZOOMSDK::DestroyMeetingService(meetingService_);
      meetingService_ = nullptr;
    }
    if (authService_ != nullptr) {
      authService_->SetEvent(nullptr);
      ZOOMSDK::DestroyAuthService(authService_);
      authService_ = nullptr;
    }
    if (sdkInitialized_) {
      ZOOMSDK::CleanUPSDK();
      sdkInitialized_ = false;
    }
    initialized_ = false;
    authenticated_ = false;
    inMeeting_ = false;
    emit("stopped", "Zoom output stopped.");
  }

 private:
  void emit(const std::string& state, const std::string& message) {
    EventHandler handler;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      handler = eventHandler_;
    }
    if (handler) handler(state, message);
  }

  void onAuthenticationReturn(ZOOMSDK::AuthResult result) override {
    if (result == ZOOMSDK::AUTHRET_SUCCESS) {
      authenticated_ = true;
      emit("authenticated", "Zoom Meeting SDK authenticated.");
    } else {
      authenticated_ = false;
      emit("error", "Zoom Meeting SDK authentication failed (result " +
                        std::to_string(static_cast<int>(result)) + ").");
    }
  }
  void onLoginReturnWithReason(ZOOMSDK::LOGINSTATUS, ZOOMSDK::IAccountInfo*,
                               ZOOMSDK::LoginFailReason) override {}
  void onLogout() override { authenticated_ = false; emit("error", "Zoom SDK session signed out."); }
  void onZoomIdentityExpired() override { authenticated_ = false; emit("error", "Zoom identity expired; reconnect the Zoom account."); }
  void onZoomAuthIdentityExpired() override { emit("error", "Zoom SDK authentication expired; reconnect the Zoom account."); }
  void onNotificationServiceStatus(ZOOMSDK::SDKNotificationServiceStatus,
                                   ZOOMSDK::SDKNotificationServiceError) override {}

  void onMeetingStatusChanged(ZOOMSDK::MeetingStatus status, int result) override {
    switch (status) {
      case ZOOMSDK::MEETING_STATUS_CONNECTING:
      case ZOOMSDK::MEETING_STATUS_WAITINGFORHOST:
        emit("meeting-connecting", "Connecting to Zoom meeting.");
        break;
      case ZOOMSDK::MEETING_STATUS_INMEETING:
        inMeeting_ = true;
        emit("meeting", "Joined Zoom meeting.");
        break;
      case ZOOMSDK::MEETING_STATUS_FAILED:
        inMeeting_ = false;
        emit("error", "Could not join Zoom meeting (result " + std::to_string(result) + ").");
        break;
      case ZOOMSDK::MEETING_STATUS_ENDED:
      case ZOOMSDK::MEETING_STATUS_IDLE:
        inMeeting_ = false;
        emit("meeting-ended", "Zoom meeting ended.");
        break;
      default:
        break;
    }
  }
  void onMeetingStatisticsWarningNotification(ZOOMSDK::StatisticsWarningType) override {}
  void onMeetingParameterNotification(const ZOOMSDK::MeetingParameter*) override {}
  void onSuspendParticipantsActivities() override {}
  void onAICompanionActiveChangeNotice(bool) override {}
  void onMeetingTopicChanged(const zchar_t*) override {}
  void onMeetingFullToWatchLiveStream(const zchar_t*) override {
    emit("error", "Zoom meeting is full; this sender cannot join the live stream.");
  }
  void onUserNetworkStatusChanged(ZOOMSDK::MeetingComponentType, ZOOMSDK::ConnectionQuality,
                                  unsigned int, bool) override {}
  void onAppSignalPanelUpdated(ZOOMSDK::IMeetingAppSignalHandler*) override {}

  void onStartPSModeResult(bool success) override {
    if (!success) emit("error", "Zoom could not start Production Studio.");
  }
  void onStartSend(ZOOMSDK::IZoomSDKPSSender* sender) override {
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender_ = sender;
    }
    emit("production-studio", "Zoom Production Studio is sending media.");
  }
  void onStopSend() override {
    {
      std::lock_guard<std::mutex> lock(senderMutex_);
      sender_ = nullptr;
    }
    emit("meeting", "Zoom Production Studio stopped.");
  }
  void onPSUserStatusChanged(unsigned int, bool) override {}

  std::mutex mutex_;
  std::mutex senderMutex_;
  EventHandler eventHandler_;
  ZOOMSDK::IAuthService* authService_ = nullptr;
  ZOOMSDK::IMeetingService* meetingService_ = nullptr;
  ZOOMSDK::IZoomSDKPSSender* sender_ = nullptr;  // Borrowed; valid only between SDK start/stop callbacks.
  std::wstring zak_;
  std::wstring displayName_;
  unsigned int width_ = 0;
  unsigned int height_ = 0;
  std::atomic<bool> authenticated_{false};
  std::atomic<bool> inMeeting_{false};
  std::atomic<bool> initialized_{false};
  bool sdkInitialized_ = false;
};

SdkBridge* createPlatformSdkBridge() { return new WindowsSdkBridge(); }
void destroyPlatformSdkBridge(SdkBridge* bridge) { delete bridge; }

}  // namespace lumastream::zoom
