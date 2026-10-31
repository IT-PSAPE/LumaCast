// Mock NDI runtime used by the native pacing regression test.
//
// It implements the subset of the NDI SDK symbols that @lumacast/ndi-native
// loads, recording the values the bridge passes so the test can assert on
// pacing decisions: the per-sender `clock_video` flag and the video frame
// rate numerator/denominator metadata on every video frame.
//
// Recorded calls are written as JSON to the path in NDI_MOCK_REPORT_PATH so
// the JavaScript test can read them without any native bindings of its own.
//
// The report path is read from the environment on every write (rather than
// cached in a global) because the host addon may unload and reload this
// library across sender lifecycles, which would reset static state.

#include <cstdint>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <mutex>
#include <thread>

#ifdef _WIN32
#define MOCK_NDI_EXPORT __declspec(dllexport)
#else
#define MOCK_NDI_EXPORT
#endif

extern "C" {

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

struct NDIlib_source_t {
  const char* p_ndi_name;
  const char* p_url_address;
};

struct NDIlib_find_create_t {
  bool show_local_sources;
  const char* p_groups;
  const char* p_extra_ips;
};

struct NDIlib_recv_create_v3_t {
  NDIlib_source_t source_to_connect_to;
  int32_t color_format;
  int32_t bandwidth;
  bool allow_video_fields;
  const char* p_ndi_name;
};

struct NDIlib_audio_frame_v3_t {
  int32_t sample_rate;
  int32_t no_channels;
  int32_t no_samples;
  int64_t timecode;
  uint32_t FourCC;
  uint8_t* p_data;
  int32_t channel_stride_in_bytes;
  const char* p_metadata;
  int64_t timestamp;
};

struct MockReceiver {
  bool oversized = false;
  bool overflowDimensions = false;
  bool bgrx = false;
  uint32_t nextFrame = 0;
};

struct MockFinder {
  uint32_t waitCalls = 0;
};

struct NDIlib_tally_t {
  bool on_program;
  bool on_preview;
};

using NDIlib_find_instance_t = void*;
using NDIlib_recv_instance_t = void*;

static void WriteReport(int createClockVideo,
                        int createClockAudio,
                        int videoFrameDelta,
                        int videoFrameRateN,
                        int videoFrameRateD) {
  const char* path = std::getenv("NDI_MOCK_REPORT_PATH");
  if (path == nullptr || path[0] == '\0') {
    return;
  }

  int curCreateVideo = -1;
  int curCreateAudio = -1;
  int curSenderCreates = 0;
  int curInvalidClockVideoCreates = 0;
  int curFrames = 0;
  int curInvalidPacingFrames = 0;
  int curRateN = -1;
  int curRateD = -1;
  int curCustomFrameRateFrames = 0;
  int curInvalidFrameRateFrames = 0;

  FILE* in = std::fopen(path, "r");
  if (in != nullptr) {
    char buffer[512];
    if (std::fgets(buffer, sizeof(buffer), in) != nullptr) {
      std::sscanf(buffer,
                  "{\"createClockVideo\":%d,\"createClockAudio\":%d,"
                  "\"senderCreates\":%d,\"invalidClockVideoCreates\":%d,"
                  "\"videoFrames\":%d,\"invalidPacingFrames\":%d,"
                  "\"videoFrameRateN\":%d,\"videoFrameRateD\":%d,"
                  "\"customFrameRateFrames\":%d,\"invalidFrameRateFrames\":%d",
                  &curCreateVideo, &curCreateAudio, &curSenderCreates,
                  &curInvalidClockVideoCreates, &curFrames, &curInvalidPacingFrames,
                  &curRateN, &curRateD, &curCustomFrameRateFrames, &curInvalidFrameRateFrames);
    }
    std::fclose(in);
  }

  if (createClockVideo >= 0) {
    curCreateVideo = createClockVideo;
    curSenderCreates += 1;
    if (createClockVideo != 0) curInvalidClockVideoCreates += 1;
  }
  if (createClockAudio >= 0) {
    curCreateAudio = createClockAudio;
  }
  curFrames += videoFrameDelta;
  if (videoFrameDelta > 0 &&
      (videoFrameRateN != 30000 || videoFrameRateD != 1001)) {
    curInvalidPacingFrames += videoFrameDelta;
  }
  if (videoFrameDelta > 0) {
    if (videoFrameRateN == 60 && videoFrameRateD == 1) curCustomFrameRateFrames += videoFrameDelta;
    else if (videoFrameRateN != 30000 || videoFrameRateD != 1001) curInvalidFrameRateFrames += videoFrameDelta;
  }
  if (videoFrameRateN >= 0) {
    curRateN = videoFrameRateN;
    curRateD = videoFrameRateD;
  }

  FILE* out = std::fopen(path, "w");
  if (out == nullptr) {
    return;
  }
  std::fprintf(out,
               "{\"createClockVideo\":%d,\"createClockAudio\":%d,"
               "\"senderCreates\":%d,\"invalidClockVideoCreates\":%d,"
               "\"videoFrames\":%d,\"invalidPacingFrames\":%d,"
               "\"videoFrameRateN\":%d,\"videoFrameRateD\":%d,"
               "\"customFrameRateFrames\":%d,\"invalidFrameRateFrames\":%d}\n",
               curCreateVideo, curCreateAudio, curSenderCreates,
               curInvalidClockVideoCreates, curFrames, curInvalidPacingFrames,
               curRateN, curRateD, curCustomFrameRateFrames, curInvalidFrameRateFrames);
  std::fclose(out);
}

static uint32_t ReadRgbMarker(const NDIlib_video_frame_v2_t* frame,
                              int64_t pixelIndex) {
  if (frame == nullptr || frame->p_data == nullptr || pixelIndex < 0) {
    return 0;
  }
  const int64_t byteOffset = pixelIndex * 4;
  return (static_cast<uint32_t>(frame->p_data[byteOffset]) << 16) |
         (static_cast<uint32_t>(frame->p_data[byteOffset + 1]) << 8) |
         static_cast<uint32_t>(frame->p_data[byteOffset + 2]);
}

static void AppendFrameReport(const NDIlib_video_frame_v2_t* frame) {
  const char* path = std::getenv("NDI_MOCK_FRAME_REPORT_PATH");
  if (path == nullptr || path[0] == '\0' || frame == nullptr ||
      frame->p_data == nullptr || frame->xres <= 0 || frame->yres <= 0) {
    return;
  }

  const int64_t pixelCount =
      static_cast<int64_t>(frame->xres) * static_cast<int64_t>(frame->yres);
  FILE* out = std::fopen(path, "a");
  if (out == nullptr) {
    return;
  }
  constexpr uint32_t kFourCcUyvy = 0x59565955U;
  constexpr uint32_t kFourCcUyva = 0x41565955U;
  if (frame->FourCC == kFourCcUyvy || frame->FourCC == kFourCcUyva) {
    if (frame->xres < 2 || frame->line_stride_in_bytes < frame->xres * 2) {
      std::fclose(out);
      return;
    }
    const auto* bytes = frame->p_data;
    const int64_t colorBytes = static_cast<int64_t>(frame->line_stride_in_bytes) * frame->yres;
    const int alphaFirst = frame->FourCC == kFourCcUyva ? bytes[colorBytes] : -1;
    const int alphaLast = frame->FourCC == kFourCcUyva ? bytes[colorBytes + pixelCount - 1] : -1;
    std::fprintf(out,
        "{\"width\":%d,\"height\":%d,\"stride\":%d,\"fourCC\":%u,"
        "\"uyvy0\":%u,\"uyvy1\":%u,\"uyvy2\":%u,\"uyvy3\":%u,"
        "\"alphaFirst\":%d,\"alphaLast\":%d}\n",
        frame->xres, frame->yres, frame->line_stride_in_bytes, frame->FourCC,
        bytes[0], bytes[1], bytes[2], bytes[3], alphaFirst, alphaLast);
    std::fclose(out);
    return;
  }
  const bool rgbaLayout = frame->FourCC == 0x41524742U || frame->FourCC == 0x58524742U
      || frame->FourCC == 0x41424752U || frame->FourCC == 0x58424752U;
  if (!rgbaLayout || frame->line_stride_in_bytes < frame->xres * 4) {
    std::fprintf(out, "{\"width\":%d,\"height\":%d,\"stride\":%d,\"fourCC\":%u}\n",
                 frame->xres, frame->yres, frame->line_stride_in_bytes, frame->FourCC);
    std::fclose(out);
    return;
  }
  std::fprintf(
      out,
      "{\"width\":%d,\"height\":%d,\"stride\":%d,\"fourCC\":%u,"
      "\"marker0\":%u,\"marker1\":%u,\"marker2\":%u,\"marker3\":%u}\n",
      frame->xres, frame->yres, frame->line_stride_in_bytes, frame->FourCC,
      ReadRgbMarker(frame, 0),
      ReadRgbMarker(frame, pixelCount / 3),
      ReadRgbMarker(frame, (pixelCount * 2) / 3),
      ReadRgbMarker(frame, pixelCount - 1));
  std::fclose(out);
}

static std::mutex g_audio_report_mutex;

static void AppendAudioReport(const NDIlib_audio_frame_v2_t* frame) {
  const char* path = std::getenv("NDI_MOCK_AUDIO_REPORT_PATH");
  if (path == nullptr || path[0] == '\0' || frame == nullptr ||
      frame->p_data == nullptr || frame->no_samples <= 0) {
    return;
  }

  const char* delayText = std::getenv("NDI_MOCK_AUDIO_DELAY_MS");
  if (delayText != nullptr) {
    const int delayMs = std::atoi(delayText);
    if (delayMs > 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
    }
  }

  std::lock_guard<std::mutex> guard(g_audio_report_mutex);
  FILE* out = std::fopen(path, "a");
  if (out == nullptr) {
    return;
  }
  std::fprintf(
      out,
      "{\"marker\":%.0f,\"sampleRate\":%d,\"channels\":%d,\"samplesPerChannel\":%d}\n",
      frame->p_data[0], frame->sample_rate, frame->no_channels,
      frame->no_samples);
  std::fclose(out);
}

MOCK_NDI_EXPORT bool NDIlib_initialize(void) { return true; }

MOCK_NDI_EXPORT void NDIlib_destroy(void) {}

MOCK_NDI_EXPORT void* NDIlib_send_create(const NDIlib_send_create_t* create) {
  const int clockVideo = (create != nullptr && create->clock_video) ? 1 : 0;
  const int clockAudio = (create != nullptr && create->clock_audio) ? 1 : 0;
  WriteReport(clockVideo, clockAudio, 0, -1, -1);
  // Any non-null handle is treated as a valid sender instance.
  return reinterpret_cast<void*>(static_cast<uintptr_t>(0x1));
}

MOCK_NDI_EXPORT void NDIlib_send_destroy(void* /*instance*/) {}

MOCK_NDI_EXPORT void NDIlib_send_send_video_v2(void* /*instance*/,
                               const NDIlib_video_frame_v2_t* frame) {
  if (frame == nullptr) {
    return;
  }
  AppendFrameReport(frame);
  WriteReport(-1, -1, 1, frame->frame_rate_N, frame->frame_rate_D);
}

MOCK_NDI_EXPORT void NDIlib_send_send_video_async_v2(void* /*instance*/,
                                     const NDIlib_video_frame_v2_t* frame) {
  if (frame == nullptr) {
    return;
  }
  AppendFrameReport(frame);
  WriteReport(-1, -1, 1, frame->frame_rate_N, frame->frame_rate_D);
}

MOCK_NDI_EXPORT void NDIlib_send_send_audio_v2(void* /*instance*/,
                               const NDIlib_audio_frame_v2_t* frame) {
  AppendAudioReport(frame);
}

MOCK_NDI_EXPORT int32_t NDIlib_send_get_no_connections(void* /*instance*/,
                                       uint32_t /*timeout_ms*/) {
  return 0;
}

MOCK_NDI_EXPORT bool NDIlib_send_get_tally(void* /*instance*/, NDIlib_tally_t* tally,
                           uint32_t /*timeout_ms*/) {
  if (tally != nullptr) {
    tally->on_program = false;
    tally->on_preview = false;
  }
  return true;
}

MOCK_NDI_EXPORT NDIlib_find_instance_t NDIlib_find_create_v2(const NDIlib_find_create_t* /*settings*/) {
  return new MockFinder();
}

MOCK_NDI_EXPORT void NDIlib_find_destroy(NDIlib_find_instance_t instance) {
  delete static_cast<MockFinder*>(instance);
}

MOCK_NDI_EXPORT bool NDIlib_find_wait_for_sources(NDIlib_find_instance_t instance, uint32_t timeoutMs) {
  auto* finder = static_cast<MockFinder*>(instance);
  if (!finder) return false;
  ++finder->waitCalls;
  if (finder->waitCalls <= 2) return true;
  if (timeoutMs > 0) std::this_thread::sleep_for(std::chrono::milliseconds(timeoutMs));
  return false;
}

MOCK_NDI_EXPORT const NDIlib_source_t* NDIlib_find_get_current_sources(NDIlib_find_instance_t instance, uint32_t* count) {
  static const NDIlib_source_t sources[] = {
      {"Mock NDI Source", "ndi://mock/source"},
      {"Oversized NDI Source", "ndi://mock/oversized"},
      {"Overflow NDI Source", "ndi://mock/overflow"},
      {"BGRX NDI Source", "ndi://mock/bgrx"},
  };
  const auto* finder = static_cast<const MockFinder*>(instance);
  const uint32_t sourceCount = finder && finder->waitCalls > 0 && finder->waitCalls <= 2
      ? 1U
      : static_cast<uint32_t>(sizeof(sources) / sizeof(sources[0]));
  if (count) *count = sourceCount;
  return sources;
}

MOCK_NDI_EXPORT void* NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t* settings) {
  if (!settings || !settings->source_to_connect_to.p_ndi_name) return nullptr;
  auto* receiver = new MockReceiver();
  receiver->oversized = std::strcmp(settings->source_to_connect_to.p_ndi_name, "Oversized NDI Source") == 0;
  receiver->overflowDimensions = std::strcmp(settings->source_to_connect_to.p_ndi_name, "Overflow NDI Source") == 0;
  receiver->bgrx = std::strcmp(settings->source_to_connect_to.p_ndi_name, "BGRX NDI Source") == 0;
  return receiver;
}

MOCK_NDI_EXPORT void NDIlib_recv_destroy(void* instance) {
  delete static_cast<MockReceiver*>(instance);
}

MOCK_NDI_EXPORT int32_t NDIlib_recv_capture_v3(void* instance, NDIlib_video_frame_v2_t* video,
                               NDIlib_audio_frame_v3_t* audio, void* /*metadata*/,
                               uint32_t /*timeoutMs*/) {
  auto* receiver = static_cast<MockReceiver*>(instance);
  if (!receiver) return 4;
  const char* delayValue = std::getenv("NDI_MOCK_RECEIVE_DELAY_MS");
  const int delayMs = delayValue ? std::clamp(std::atoi(delayValue), 0, 1000) : 0;
  if (delayMs > 0) std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
  if (receiver->nextFrame++ == 0 && video) {
    video->xres = receiver->overflowDimensions ? 2147483647 : receiver->oversized ? 3840 : 2;
    video->yres = receiver->overflowDimensions ? 2147483647 : receiver->oversized ? 2161 : 2;
    video->FourCC = receiver->bgrx ? 0x58524742U : 0x41524742U;  // BGRX or BGRA
    video->frame_rate_N = 60;
    video->frame_rate_D = 1;
    video->frame_format_type = 1;
    video->p_data = new uint8_t[receiver->oversized || receiver->overflowDimensions ? 1 : 16];
    video->line_stride_in_bytes = receiver->overflowDimensions ? 2147483647 : receiver->oversized ? 3840 * 4 : 8;
    if (!receiver->oversized && !receiver->overflowDimensions) {
      for (int index = 0; index < 16; index += 4) {
        video->p_data[index + 0] = 10;
        video->p_data[index + 1] = 20;
        video->p_data[index + 2] = 30;
        video->p_data[index + 3] = receiver->bgrx ? 0 : 255;
      }
    }
    return 1;
  }
  if (!receiver->oversized && receiver->nextFrame == 2 && audio) {
    audio->sample_rate = 48000;
    audio->no_channels = 2;
    audio->no_samples = 4;
    audio->FourCC = 0x70544C46U;  // FLTp
    audio->p_data = reinterpret_cast<uint8_t*>(new float[8]{0.1f, 0.2f, 0.3f, 0.4f, -0.1f, -0.2f, -0.3f, -0.4f});
    audio->channel_stride_in_bytes = 4 * static_cast<int32_t>(sizeof(float));
    return 2;
  }
  return 0;
}

MOCK_NDI_EXPORT void NDIlib_recv_free_video_v2(void* /*instance*/, const NDIlib_video_frame_v2_t* frame) {
  delete[] frame->p_data;
}

MOCK_NDI_EXPORT void NDIlib_recv_free_audio_v3(void* /*instance*/, const NDIlib_audio_frame_v3_t* frame) {
  delete[] reinterpret_cast<float*>(frame->p_data);
}

}  // extern "C"
