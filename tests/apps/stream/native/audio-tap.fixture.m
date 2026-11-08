// Exercise the actual helper's conversion/callback path without creating a tap,
// inspecting running processes, or requesting any capture permission.
#define main StreamAudioHelperMain
#include "main.m"
#undef main

#include <assert.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <time.h>

static uint64_t ResidentBytes(void) {
  struct mach_task_basic_info info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  assert(task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) == KERN_SUCCESS);
  return info.resident_size;
}

int main(void) {
  @autoreleasepool {
    signal(SIGPIPE, SIG_IGN);
    FILE *report = fdopen(dup(STDOUT_FILENO), "w");
    assert(report);
    int descriptors[2];
    assert(pipe(descriptors) == 0);
    int flags = fcntl(descriptors[1], F_GETFL);
    assert(flags >= 0 && fcntl(descriptors[1], F_SETFL, flags | O_NONBLOCK) == 0);
    const uint8_t filler[1024] = {0};
    while (write(descriptors[1], filler, sizeof filler) > 0) { }
    assert(errno == EAGAIN || errno == EWOULDBLOCK);
    assert(fcntl(descriptors[1], F_SETFL, flags) == 0);
    assert(dup2(descriptors[1], STDOUT_FILENO) == STDOUT_FILENO);
    assert(close(descriptors[1]) == 0);

    if (@available(macOS 14.2, *)) {
      struct { atomic_uint calls; atomic_int code; atomic_bool hasBudgetDiagnostic; } observation = {0};
      typeof(observation) *result = &observation;
      TapSession *session = [[TapSession alloc] initWithDescriptionBuilder:^CATapDescription *{ return nil; }
        onFailure:^(NSError *error) {
          atomic_store(&result->code, (int)error.code);
          atomic_store(&result->hasBudgetDiagnostic, [error.localizedDescription containsString:@"250 ms buffer budget"]);
          atomic_fetch_add(&result->calls, 1);
        }];
      AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:48000 channels:2 interleaved:YES];
      // Configure only the converter. In particular, never call startWithError:
      // it creates CoreAudio resources and would request real capture access.
      [session setValue:format forKey:@"inputFormat"];
      [session setValue:[[AVAudioConverter alloc] initFromFormat:format toFormat:format] forKey:@"converter"];
      float pcm[960] = {0};
      AudioBufferList input = { .mNumberBuffers = 1,
        .mBuffers = { { .mNumberChannels = 2, .mDataByteSize = sizeof pcm, .mData = pcm } } };
      uint64_t before = ResidentBytes();
      struct timespec start, end;
      assert(clock_gettime(CLOCK_MONOTONIC, &start) == 0);
      for (unsigned block = 0; block < 5000; block += 1) {
        @autoreleasepool { [session handleInput:&input]; }
      }
      assert(clock_gettime(CLOCK_MONOTONIC, &end) == 0);
      uint64_t after = ResidentBytes();
      for (unsigned wait = 0; wait < 1000 && atomic_load(&observation.calls) == 0; wait += 1) usleep(1000);
      [session stop];
      [session stop];
      assert(atomic_load(&observation.calls) == 1);
      assert(atomic_load(&observation.code) == ExitFailure);
      assert(atomic_load(&observation.hasBudgetDiagnostic));
      double elapsed = (end.tv_sec - start.tv_sec) * 1000.0 + (end.tv_nsec - start.tv_nsec) / 1000000.0;
      assert(elapsed < 200);
      // A coarse regression bound complements the exact ring-capacity proof.
      // The prior unbounded callback retained >21 MB for this same 19.2 MB burst.
      uint64_t growth = after >= before ? after - before : 0;
      assert(growth < 8 * 1024 * 1024);
      fprintf(report, "PASS callback blocks=5000 offered_pcm_bytes=19200000 failure_calls=%u resident_growth_bytes=%llu elapsed_ms=%.3f\n",
        atomic_load(&observation.calls), (unsigned long long)growth, elapsed);
      fclose(report);
      close(descriptors[0]);
      return 0;
    }
    return ExitUnsupportedSystem;
  }
}
