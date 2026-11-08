#include "pcm-writer.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  atomic_uint calls;
  atomic_int state;
  atomic_int errorNumber;
} Failure;

static uint64_t Now(void) {
  struct timespec time;
  assert(clock_gettime(CLOCK_MONOTONIC, &time) == 0);
  return (uint64_t)time.tv_sec * 1000 + (uint64_t)time.tv_nsec / 1000000;
}

static void Sleep(unsigned milliseconds) {
  struct timespec time = { .tv_sec = milliseconds / 1000, .tv_nsec = (milliseconds % 1000) * 1000000 };
  while (nanosleep(&time, &time) < 0) assert(errno == EINTR);
}

static void OnFailure(PCMWriterState state, int errorNumber, void *context) {
  Failure *failure = context;
  atomic_store(&failure->state, state);
  atomic_store(&failure->errorNumber, errorNumber);
  atomic_fetch_add(&failure->calls, 1);
}

static void WaitForFailure(Failure *failure, PCMWriterState expected) {
  uint64_t deadline = Now() + 1500;
  while (atomic_load(&failure->calls) == 0 && Now() < deadline) Sleep(1);
  assert(atomic_load(&failure->calls) == 1);
  assert(atomic_load(&failure->state) == (int)expected);
}

static PCMWriter *NewWriter(int descriptors[2], Failure *failure) {
  assert(pipe(descriptors) == 0);
  PCMWriter *writer = PCMWriterCreate(descriptors[1], OnFailure, failure);
  assert(writer);
  return writer;
}

static size_t FillPipe(int descriptor) {
  int flags = fcntl(descriptor, F_GETFL);
  assert(flags >= 0 && fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0);
  const uint8_t zeros[1024] = {0};
  size_t count = 0;
  for (;;) {
    ssize_t written = write(descriptor, zeros, sizeof zeros);
    if (written > 0) count += (size_t)written;
    else {
      assert(written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK));
      break;
    }
  }
  assert(fcntl(descriptor, F_SETFL, flags) == 0);
  return count;
}

static void ReadExactly(int descriptor, uint8_t *bytes, size_t length) {
  uint64_t deadline = Now() + 1500;
  while (length > 0) {
    struct pollfd ready = { .fd = descriptor, .events = POLLIN };
    assert(Now() < deadline && poll(&ready, 1, 100) >= 0);
    if (!(ready.revents & POLLIN)) continue;
    // Odd-sized reads deliberately split stereo frames and writer chunks.
    size_t count = length < 997 ? length : 997;
    ssize_t readCount = read(descriptor, bytes, count);
    assert(readCount > 0);
    bytes += readCount;
    length -= (size_t)readCount;
  }
}

static void Finish(PCMWriter *writer, int descriptors[2], Failure *failure) {
  PCMWriterStop(writer);
  unsigned calls = atomic_load(&failure->calls);
  PCMWriterDestroy(writer);
  Sleep(1);
  assert(atomic_load(&failure->calls) == calls);
  assert(close(descriptors[0]) == 0);
  assert(close(descriptors[1]) == 0); // The writer never closes borrowed stdout.
}

static void ExactFIFOAndRecovery(void) {
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  size_t fillerLength = FillPipe(descriptors[1]);
  Failure failure = {0};
  PCMWriter *writer = PCMWriterCreate(descriptors[1], OnFailure, &failure);
  assert(writer);
  // Leave room for one write whose bytes the reader has seen but whose head
  // publication has not yet run; reading bytes is not a worker-thread barrier.
  float pcm[PCMWriterCapacityBytes / 2 / sizeof(float)];
  for (size_t i = 0; i < sizeof pcm / sizeof pcm[0]; i += 1) pcm[i] = (float)(i % 1024) / 1024.0f;
  assert(PCMWriterEnqueue(writer, pcm, sizeof pcm));
  Sleep(40); // Output is genuinely blocked before the reader resumes.
  uint8_t filler[1024];
  while (fillerLength > 0) {
    size_t count = fillerLength < sizeof filler ? fillerLength : sizeof filler;
    ReadExactly(descriptors[0], filler, count);
    for (size_t i = 0; i < count; i += 1) assert(filler[i] == 0);
    fillerLength -= count;
  }
  uint8_t actual[sizeof pcm];
  ReadExactly(descriptors[0], actual, sizeof actual);
  assert(memcmp(actual, pcm, sizeof actual) == 0);

  // More than eight ring revolutions, including physical wrap and split pipe reads.
  for (unsigned block = 0; block < 16; block += 1) {
    pcm[0] = (float)block;
    assert(PCMWriterEnqueue(writer, pcm, sizeof pcm));
    ReadExactly(descriptors[0], actual, sizeof actual);
    assert(memcmp(actual, pcm, sizeof actual) == 0);
  }
  Sleep(PCMWriterLatencyMilliseconds + 30);
  assert(atomic_load(&failure.calls) == 0); // Empty output disarms the deadline.
  assert(PCMWriterEnqueue(writer, pcm, PCMWriterFrameBytes));
  ReadExactly(descriptors[0], actual, PCMWriterFrameBytes);
  assert(memcmp(actual, pcm, PCMWriterFrameBytes) == 0);
  Finish(writer, descriptors, &failure);
}

static void BoundedPressure(void) {
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  (void)FillPipe(descriptors[1]);
  Failure failure = {0};
  PCMWriter *writer = PCMWriterCreate(descriptors[1], OnFailure, &failure);
  assert(writer);
  uint8_t pcm[PCMWriterCapacityBytes] = {0};
  uint64_t start = Now();
  assert(PCMWriterEnqueue(writer, pcm, sizeof pcm));
  // The very next whole frame must fail; in-flight writes have not released space.
  for (unsigned i = 0; i < 5000; i += 1) assert(!PCMWriterEnqueue(writer, pcm, PCMWriterFrameBytes));
  uint64_t elapsed = Now() - start;
  assert(elapsed < 200);
  WaitForFailure(&failure, PCMWriterOverflow);
  printf("pressure capacity_bytes=%d producer_5001_calls_ms=%llu failure_calls=%u\n",
    PCMWriterCapacityBytes, (unsigned long long)elapsed, atomic_load(&failure.calls));
  Finish(writer, descriptors, &failure);
}

static void StallAndIdle(void) {
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  (void)FillPipe(descriptors[1]);
  Failure failure = {0};
  PCMWriter *writer = PCMWriterCreate(descriptors[1], OnFailure, &failure);
  assert(writer);
  Sleep(PCMWriterLatencyMilliseconds + 30);
  assert(atomic_load(&failure.calls) == 0);
  uint8_t frame[PCMWriterFrameBytes] = {0};
  uint64_t start = Now();
  assert(PCMWriterEnqueue(writer, frame, sizeof frame));
  WaitForFailure(&failure, PCMWriterStalled);
  uint64_t elapsed = Now() - start;
  assert(elapsed >= PCMWriterLatencyMilliseconds && elapsed < 1000);
  printf("stall pending_timeout_ms=%llu\n", (unsigned long long)elapsed);
  Finish(writer, descriptors, &failure);
}

static void ClosedAndFailedOutput(void) {
  int descriptors[2];
  Failure failure = {0};
  PCMWriter *writer = NewWriter(descriptors, &failure);
  assert(close(descriptors[0]) == 0);
  uint8_t frame[PCMWriterFrameBytes] = {0};
  assert(PCMWriterEnqueue(writer, frame, sizeof frame));
  WaitForFailure(&failure, PCMWriterParentClosed);
  assert(atomic_load(&failure.errorNumber) == EPIPE);
  PCMWriterDestroy(writer);
  assert(close(descriptors[1]) == 0);

  failure = (Failure){0};
  int readOnly = open("/dev/null", O_RDONLY);
  assert(readOnly >= 0);
  writer = PCMWriterCreate(readOnly, OnFailure, &failure);
  assert(writer && PCMWriterEnqueue(writer, frame, sizeof frame));
  WaitForFailure(&failure, PCMWriterWriteError);
  assert(atomic_load(&failure.errorNumber) == EBADF);
  PCMWriterDestroy(writer);
  assert(close(readOnly) == 0);

  errno = 0;
  assert(PCMWriterCreate(-1, OnFailure, &failure) == NULL && errno == EBADF);
}

typedef struct { PCMWriter *writer; atomic_bool started; } Producer;
static void *ProduceUntilStopped(void *context) {
  Producer *producer = context;
  uint8_t frame[PCMWriterFrameBytes] = {0};
  atomic_store(&producer->started, true);
  while (PCMWriterEnqueue(producer->writer, frame, sizeof frame)) { }
  return NULL;
}

static void StopAndDescriptorLifecycle(void) {
  // Force creation to fail after stdout became nonblocking, and prove rollback.
  int rollbackDescriptors[2];
  assert(pipe(rollbackDescriptors) == 0);
  int originalFlags = fcntl(rollbackDescriptors[1], F_GETFL);
  struct rlimit originalLimit;
  assert(getrlimit(RLIMIT_NOFILE, &originalLimit) == 0);
  struct rlimit constrained = originalLimit;
  constrained.rlim_cur = 3;
  assert(setrlimit(RLIMIT_NOFILE, &constrained) == 0);
  errno = 0;
  PCMWriter *uncreated = PCMWriterCreate(rollbackDescriptors[1], NULL, NULL);
  int creationError = errno;
  assert(setrlimit(RLIMIT_NOFILE, &originalLimit) == 0);
  assert(!uncreated && creationError == EMFILE);
  assert(fcntl(rollbackDescriptors[1], F_GETFL) == originalFlags);
  assert(close(rollbackDescriptors[0]) == 0 && close(rollbackDescriptors[1]) == 0);

  int blockedDescriptors[2];
  assert(pipe(blockedDescriptors) == 0);
  (void)FillPipe(blockedDescriptors[1]);
  Failure blockedFailure = {0};
  PCMWriter *blocked = PCMWriterCreate(blockedDescriptors[1], OnFailure, &blockedFailure);
  uint8_t pending[PCMWriterCapacityBytes] = {0};
  assert(blocked && PCMWriterEnqueue(blocked, pending, sizeof pending));
  Sleep(10);
  uint64_t stopStart = Now();
  PCMWriterStop(blocked);
  assert(Now() - stopStart < 200 && atomic_load(&blockedFailure.calls) == 0);
  Finish(blocked, blockedDescriptors, &blockedFailure);

  for (unsigned iteration = 0; iteration < 64; iteration += 1) {
    int descriptors[2];
    assert(pipe(descriptors) == 0);
    int flags = fcntl(descriptors[1], F_GETFL);
    if (iteration % 2) {
      flags |= O_NONBLOCK;
      assert(fcntl(descriptors[1], F_SETFL, flags) == 0);
    }
    (void)FillPipe(descriptors[1]);
    // macOS may add a kernel-managed pipe flag once the pipe has been filled.
    flags = fcntl(descriptors[1], F_GETFL);
    Failure failure = {0};
    PCMWriter *writer = PCMWriterCreate(descriptors[1], OnFailure, &failure);
    assert(writer && (fcntl(descriptors[1], F_GETFL) & O_NONBLOCK));
    Producer producer = { .writer = writer };
    pthread_t thread;
    assert(pthread_create(&thread, NULL, ProduceUntilStopped, &producer) == 0);
    while (!atomic_load(&producer.started)) sched_yield();
    uint64_t start = Now();
    PCMWriterStop(writer);
    assert(Now() - start < 200);
    assert(pthread_join(thread, NULL) == 0); // Producer quiesces before destroy.
    assert(fcntl(descriptors[1], F_GETFL) == flags);
    uint8_t frame[PCMWriterFrameBytes] = {0};
    assert(!PCMWriterEnqueue(writer, frame, sizeof frame));
    Finish(writer, descriptors, &failure);
  }
}

static void IdleTransitionAndFrameAlignment(void) {
  int descriptors[2];
  Failure failure = {0};
  PCMWriter *writer = NewWriter(descriptors, &failure);
  const uint8_t frame[PCMWriterFrameBytes] = {1, 2, 3, 4, 5, 6, 7, 8};
  uint8_t actual[sizeof frame];
  for (unsigned iteration = 0; iteration < 256; iteration += 1) {
    assert(PCMWriterEnqueue(writer, frame, sizeof frame));
    ReadExactly(descriptors[0], actual, sizeof actual);
    assert(memcmp(actual, frame, sizeof frame) == 0);
    if (iteration % 16 == 0) Sleep(1);
  }
  assert(atomic_load(&failure.calls) == 0);
  assert(PCMWriterEnqueue(writer, NULL, 0));
  assert(!PCMWriterEnqueue(writer, frame, sizeof frame - 1));
  WaitForFailure(&failure, PCMWriterInvalidInput);
  Finish(writer, descriptors, &failure);
}

int main(void) {
  signal(SIGPIPE, SIG_IGN);
  ExactFIFOAndRecovery();
  BoundedPressure();
  StallAndIdle();
  ClosedAndFailedOutput();
  StopAndDescriptorLifecycle();
  IdleTransitionAndFrameAlignment();
  puts("PASS exact-fifo partial-write wrap recovery pressure stall close error stop lifecycle idle frame-alignment");
  return 0;
}
