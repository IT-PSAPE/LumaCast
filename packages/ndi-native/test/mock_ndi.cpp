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
#include <cstdio>
#include <cstdlib>
#include <cstring>

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

struct NDIlib_tally_t {
  bool on_program;
  bool on_preview;
};

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

  FILE* in = std::fopen(path, "r");
  if (in != nullptr) {
    char buffer[512];
    if (std::fgets(buffer, sizeof(buffer), in) != nullptr) {
      std::sscanf(buffer,
                  "{\"createClockVideo\":%d,\"createClockAudio\":%d,"
                  "\"senderCreates\":%d,\"invalidClockVideoCreates\":%d,"
                  "\"videoFrames\":%d,\"invalidPacingFrames\":%d,"
                  "\"videoFrameRateN\":%d,\"videoFrameRateD\":%d",
                  &curCreateVideo, &curCreateAudio, &curSenderCreates,
                  &curInvalidClockVideoCreates, &curFrames, &curInvalidPacingFrames,
                  &curRateN, &curRateD);
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
               "\"videoFrameRateN\":%d,\"videoFrameRateD\":%d}\n",
               curCreateVideo, curCreateAudio, curSenderCreates,
               curInvalidClockVideoCreates, curFrames, curInvalidPacingFrames,
               curRateN, curRateD);
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
  std::fprintf(
      out,
      "{\"width\":%d,\"height\":%d,\"stride\":%d,"
      "\"marker0\":%u,\"marker1\":%u,\"marker2\":%u,\"marker3\":%u}\n",
      frame->xres, frame->yres, frame->line_stride_in_bytes,
      ReadRgbMarker(frame, 0),
      ReadRgbMarker(frame, pixelCount / 3),
      ReadRgbMarker(frame, (pixelCount * 2) / 3),
      ReadRgbMarker(frame, pixelCount - 1));
  std::fclose(out);
}

bool NDIlib_initialize(void) { return true; }

void NDIlib_destroy(void) {}

void* NDIlib_send_create(const NDIlib_send_create_t* create) {
  const int clockVideo = (create != nullptr && create->clock_video) ? 1 : 0;
  const int clockAudio = (create != nullptr && create->clock_audio) ? 1 : 0;
  WriteReport(clockVideo, clockAudio, 0, -1, -1);
  // Any non-null handle is treated as a valid sender instance.
  return reinterpret_cast<void*>(static_cast<uintptr_t>(0x1));
}

void NDIlib_send_destroy(void* /*instance*/) {}

void NDIlib_send_send_video_v2(void* /*instance*/,
                               const NDIlib_video_frame_v2_t* frame) {
  if (frame == nullptr) {
    return;
  }
  AppendFrameReport(frame);
  WriteReport(-1, -1, 1, frame->frame_rate_N, frame->frame_rate_D);
}

void NDIlib_send_send_video_async_v2(void* /*instance*/,
                                     const NDIlib_video_frame_v2_t* frame) {
  if (frame == nullptr) {
    return;
  }
  AppendFrameReport(frame);
  WriteReport(-1, -1, 1, frame->frame_rate_N, frame->frame_rate_D);
}

void NDIlib_send_send_audio_v2(void* /*instance*/,
                               const NDIlib_audio_frame_v2_t* /*frame*/) {}

int32_t NDIlib_send_get_no_connections(void* /*instance*/,
                                       uint32_t /*timeout_ms*/) {
  return 0;
}

bool NDIlib_send_get_tally(void* /*instance*/, NDIlib_tally_t* tally,
                           uint32_t /*timeout_ms*/) {
  if (tally != nullptr) {
    tally->on_program = false;
    tally->on_preview = false;
  }
  return true;
}

}  // extern "C"
