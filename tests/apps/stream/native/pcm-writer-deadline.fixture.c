#include <assert.h>
#include <stdbool.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static atomic_bool paused;
static atomic_bool resumeWorker;
static atomic_int failureState;
static atomic_uint failureCalls;
static int outputDescriptor;
static ssize_t PartialWrite(int descriptor, const void *bytes, size_t length);
static bool PausedOwnershipCAS(_Atomic uint64_t *value, uint64_t *expected, uint64_t desired, memory_order success, memory_order failure);

static bool NativeOwnershipCAS(_Atomic uint64_t *value, uint64_t *expected, uint64_t desired, memory_order success, memory_order failure) {
  return atomic_compare_exchange_strong_explicit(value, expected, desired, success, failure);
}

static bool NativeStateCAS(atomic_int *value, int *expected, int desired, memory_order success, memory_order failure) {
  return atomic_compare_exchange_strong_explicit(value, expected, desired, success, failure);
}

// Pause immediately after actual reclamation, even if the worker never observes
// the empty queue on its next loop. Actual source, real monotonic clock, real
// pipe; deterministic partial writes and scheduling need no production hooks.
#undef atomic_compare_exchange_strong_explicit
#define atomic_compare_exchange_strong_explicit(value, expected, desired, success, failure) \
  _Generic((value), _Atomic uint64_t *: PausedOwnershipCAS, default: NativeStateCAS)(value, expected, desired, success, failure)
#define write PartialWrite
#include "pcm-writer.c"
#undef write
#undef atomic_compare_exchange_strong_explicit

static void Sleep(unsigned milliseconds) {
  struct timespec delay = { .tv_sec = milliseconds / 1000, .tv_nsec = (milliseconds % 1000) * 1000000 };
  while (nanosleep(&delay, &delay) < 0) assert(errno == EINTR);
}

static uint64_t Now(void) {
  struct timespec time;
  assert(clock_gettime(CLOCK_MONOTONIC, &time) == 0);
  return (uint64_t)time.tv_sec * 1000 + (uint64_t)time.tv_nsec / 1000000;
}

static bool PausedOwnershipCAS(_Atomic uint64_t *value, uint64_t *expected, uint64_t desired, memory_order success, memory_order failure) {
  uint64_t before = *expected;
  bool exchanged = NativeOwnershipCAS(value, expected, desired, success, failure);
  if (exchanged && PendingBytes(desired) < PendingBytes(before) && !atomic_exchange(&paused, true)) {
    while (!atomic_load(&resumeWorker)) Sleep(1);
  }
  return exchanged;
}

static ssize_t PartialWrite(int descriptor, const void *bytes, size_t length) {
  if (descriptor == outputDescriptor && length > PCMWriterFrameBytes) length = PCMWriterFrameBytes;
  return write(descriptor, bytes, length);
}

static void OnFailure(PCMWriterState state, int errorNumber, void *context) {
  (void)errorNumber;
  (void)context;
  atomic_store(&failureState, state);
  atomic_fetch_add(&failureCalls, 1);
}

typedef enum { LateRefill, EarlyRefill, ContinuouslyPending } DeadlineCase;

static void DeadlineAfterDescheduling(DeadlineCase testCase) {
  atomic_store(&paused, false);
  atomic_store(&resumeWorker, false);
  atomic_store(&failureState, PCMWriterRunning);
  atomic_store(&failureCalls, 0);
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  outputDescriptor = descriptors[1];
  PCMWriter *writer = PCMWriterCreate(outputDescriptor, OnFailure, NULL);
  const uint8_t frames[PCMWriterFrameBytes * 2] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
  assert(writer && PCMWriterEnqueue(writer, frames, testCase == ContinuouslyPending ? sizeof frames : PCMWriterFrameBytes));
  uint64_t deadline = Now() + 1500;
  while (!atomic_load(&paused)) { assert(Now() < deadline); Sleep(1); }
  uint8_t actual[PCMWriterFrameBytes];
  assert(read(descriptors[0], actual, sizeof actual) == sizeof actual);
  assert(memcmp(actual, frames, sizeof actual) == 0);
  if (testCase == EarlyRefill) assert(PCMWriterEnqueue(writer, frames + sizeof actual, sizeof actual));
  Sleep(PCMWriterLatencyMilliseconds + 50);
  if (testCase == LateRefill) assert(PCMWriterEnqueue(writer, frames + sizeof actual, sizeof actual));
  atomic_store(&resumeWorker, true);

  if (testCase != LateRefill) {
    deadline = Now() + 1500;
    while (atomic_load(&failureCalls) == 0) { assert(Now() < deadline); Sleep(1); }
    assert(atomic_load(&failureCalls) == 1 && atomic_load(&failureState) == PCMWriterStalled);
    struct pollfd ready = { .fd = descriptors[0], .events = POLLIN };
    assert(poll(&ready, 1, 0) == 0); // Old pending B must fail before another write.
  } else {
    struct pollfd ready = { .fd = descriptors[0], .events = POLLIN };
    assert(poll(&ready, 1, 1500) == 1 && (ready.revents & POLLIN));
    assert(read(descriptors[0], actual, sizeof actual) == sizeof actual);
    assert(memcmp(actual, frames + sizeof actual, sizeof actual) == 0);
    assert(atomic_load(&failureCalls) == 0); // Idle time cannot age newly pending B.
  }
  PCMWriterDestroy(writer);
  close(descriptors[0]);
  close(descriptors[1]);
}

int main(void) {
  signal(SIGPIPE, SIG_IGN);
  DeadlineAfterDescheduling(LateRefill);
  DeadlineAfterDescheduling(EarlyRefill);
  DeadlineAfterDescheduling(ContinuouslyPending);
  puts("PASS deadline fresh-after-empty aged-after-refill continuously-pending");
  return 0;
}
