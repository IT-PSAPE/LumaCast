#include "pcm-writer.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

enum { RingBytes = PCMWriterCapacityBytes, PollMilliseconds = 25, PendingBits = 17 };
static const uint64_t PendingMask = (UINT64_C(1) << PendingBits) - 1;
static const uint64_t TimestampMask = UINT64_MAX >> PendingBits;
_Static_assert(PCMWriterCapacityBytes < (UINT64_C(1) << PendingBits), "PCM count must fit ownership bits");

struct PCMWriter {
  int outputFD;
  int originalFlags;
  int wake[2];
  pthread_t worker;
  bool joined;
  atomic_int state;
  // Each cursor has one owner. A single lock-free value publishes/reclaims the
  // byte count together with its pending/progress time: separate atomics could
  // expose a new pending epoch with the previous epoch's expired timestamp.
  size_t head;
  size_t tail;
  _Atomic uint64_t ownership;
  PCMWriterFailure onFailure;
  void *context;
  uint8_t bytes[RingBytes];
};

static uint64_t MonotonicMilliseconds(void) {
  struct timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return (uint64_t)time.tv_sec * 1000 + (uint64_t)time.tv_nsec / 1000000;
}

static size_t PendingBytes(uint64_t ownership) {
  return (size_t)(ownership & PendingMask);
}

static uint64_t Ownership(size_t pending, uint64_t timestamp) {
  return ((timestamp & TimestampMask) << PendingBits) | (uint64_t)pending;
}

static uint64_t PendingAge(uint64_t ownership) {
  // Modular subtraction also handles the 47-bit monotonic timestamp wrapping.
  return (MonotonicMilliseconds() - (ownership >> PendingBits)) & TimestampMask;
}

static void PublishBytes(PCMWriter *writer, size_t length) {
  uint64_t current = atomic_load_explicit(&writer->ownership, memory_order_acquire);
  for (;;) {
    uint64_t next = PendingBytes(current) == 0
      ? Ownership(length, MonotonicMilliseconds()) : current + length;
    if (atomic_compare_exchange_strong_explicit(&writer->ownership, &current, next, memory_order_acq_rel, memory_order_acquire)) return;
    // The sole producer only retries when the worker reclaimed existing bytes.
  }
}

static void ReclaimBytes(PCMWriter *writer, size_t length) {
  uint64_t progressedAt = MonotonicMilliseconds();
  uint64_t current = atomic_load_explicit(&writer->ownership, memory_order_acquire);
  for (;;) {
    size_t remaining = PendingBytes(current) - length;
    uint64_t next = remaining == 0 ? 0 : Ownership(remaining, progressedAt);
    if (atomic_compare_exchange_strong_explicit(&writer->ownership, &current, next, memory_order_acq_rel, memory_order_acquire)) return;
  }
}

static void Wake(PCMWriter *writer) {
  const uint8_t byte = 1;
  // EAGAIN coalesces with a pending wake. EINTR is bounded as well: the worker's
  // 25 ms poll ceiling recovers a missed wake without delaying the audio callback.
  (void)write(writer->wake[1], &byte, 1);
}

static void DrainWake(PCMWriter *writer) {
  uint8_t bytes[128];
  // Bound draining so an active producer cannot starve actual output or stop.
  for (unsigned attempt = 0; attempt < 8; attempt += 1) {
    if (read(writer->wake[0], bytes, sizeof bytes) <= 0) return;
  }
}

static void SetFailure(PCMWriter *writer, PCMWriterState failure) {
  int expected = PCMWriterRunning;
  (void)atomic_compare_exchange_strong(&writer->state, &expected, failure);
}

static void *RunWriter(void *context) {
  PCMWriter *writer = context;
  int errorNumber = 0;
  while (atomic_load(&writer->state) == PCMWriterRunning) {
    uint64_t ownership = atomic_load_explicit(&writer->ownership, memory_order_acquire);
    size_t available = PendingBytes(ownership);
    bool pending = available != 0;
    if (pending) {
      if (PendingAge(ownership) >= PCMWriterLatencyMilliseconds) {
        SetFailure(writer, PCMWriterStalled);
        break;
      }
      size_t length = RingBytes - writer->head;
      if (length > available) length = available;
      ssize_t written = write(writer->outputFD, writer->bytes + writer->head, length);
      if (written > 0) {
        // The ring owns in-flight output too; publish free space only after write.
        writer->head = (writer->head + (size_t)written) % RingBytes;
        ReclaimBytes(writer, (size_t)written);
        continue;
      }
      if (written == 0) {
        errorNumber = EIO;
        SetFailure(writer, PCMWriterWriteError);
        break;
      }
      if (errno == EINTR) continue;
      if (errno != EAGAIN && errno != EWOULDBLOCK) {
        errorNumber = errno;
        SetFailure(writer, errno == EPIPE ? PCMWriterParentClosed : PCMWriterWriteError);
        break;
      }
    }

    struct pollfd descriptors[] = {
      { .fd = writer->wake[0], .events = POLLIN },
      { .fd = writer->outputFD, .events = pending ? POLLOUT : 0 },
    };
    int timeout = PollMilliseconds;
    if (pending) {
      uint64_t elapsed = PendingAge(ownership);
      uint64_t remaining = elapsed >= PCMWriterLatencyMilliseconds ? 0 : PCMWriterLatencyMilliseconds - elapsed;
      if (remaining < (uint64_t)timeout) timeout = (int)remaining;
    }
    int result = poll(descriptors, pending ? 2 : 1, timeout);
    if (result < 0 && errno != EINTR) {
      errorNumber = errno;
      SetFailure(writer, PCMWriterWriteError);
      break;
    }
    if (descriptors[0].revents & POLLIN) DrainWake(writer);
    // Re-read pending/state at the top even after an idle wake: a wake may have
    // coalesced while draining, but published PCM must never be stranded.
  }
  PCMWriterState state = atomic_load(&writer->state);
  if (state != PCMWriterStopped && writer->onFailure) writer->onFailure(state, errorNumber, writer->context);
  return NULL;
}

static bool SetNonblocking(int descriptor) {
  int flags = fcntl(descriptor, F_GETFL);
  return flags >= 0 && fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
    && fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0;
}

PCMWriter *PCMWriterCreate(int outputFD, PCMWriterFailure onFailure, void *context) {
  PCMWriter *writer = calloc(1, sizeof *writer);
  if (!writer) return NULL;
  writer->outputFD = outputFD;
  writer->wake[0] = writer->wake[1] = -1;
  writer->originalFlags = fcntl(outputFD, F_GETFL);
  if (writer->originalFlags < 0) goto failure;
  if (fcntl(outputFD, F_SETFL, writer->originalFlags | O_NONBLOCK) < 0) goto failure;
  if (pipe(writer->wake) < 0 || !SetNonblocking(writer->wake[0]) || !SetNonblocking(writer->wake[1])) goto failure;
  atomic_init(&writer->state, PCMWriterRunning);
  atomic_init(&writer->ownership, 0);
  if (!atomic_is_lock_free(&writer->state) || !atomic_is_lock_free(&writer->ownership)) {
    errno = ENOTSUP;
    goto failure;
  }
  writer->onFailure = onFailure;
  writer->context = context;
  int errorNumber = pthread_create(&writer->worker, NULL, RunWriter, writer);
  if (errorNumber != 0) {
    errno = errorNumber;
    goto failure;
  }
  return writer;

failure: {
    int savedError = errno;
    if (writer->wake[0] >= 0) close(writer->wake[0]);
    if (writer->wake[1] >= 0) close(writer->wake[1]);
    if (writer->originalFlags >= 0) (void)fcntl(outputFD, F_SETFL, writer->originalFlags);
    free(writer);
    errno = savedError;
    return NULL;
  }
}

bool PCMWriterEnqueue(PCMWriter *writer, const void *bytes, size_t length) {
  if (atomic_load(&writer->state) != PCMWriterRunning) return false;
  if (length == 0) return true;
  if (!bytes || length % PCMWriterFrameBytes != 0) {
    SetFailure(writer, PCMWriterInvalidInput);
    Wake(writer);
    return false;
  }
  size_t used = PendingBytes(atomic_load_explicit(&writer->ownership, memory_order_acquire));
  if (length > PCMWriterCapacityBytes - used) {
    SetFailure(writer, PCMWriterOverflow);
    Wake(writer);
    return false;
  }
  size_t contiguous = RingBytes - writer->tail;
  if (contiguous > length) contiguous = length;
  memcpy(writer->bytes + writer->tail, bytes, contiguous);
  if (contiguous < length) memcpy(writer->bytes, (const uint8_t *)bytes + contiguous, length - contiguous);
  writer->tail = (writer->tail + length) % RingBytes;
  PublishBytes(writer, length);
  Wake(writer);
  return true;
}

void PCMWriterStop(PCMWriter *writer) {
  if (!writer || writer->joined) return;
  atomic_store(&writer->state, PCMWriterStopped);
  Wake(writer);
  (void)pthread_join(writer->worker, NULL);
  writer->joined = true;
  (void)fcntl(writer->outputFD, F_SETFL, writer->originalFlags);
}

void PCMWriterDestroy(PCMWriter *writer) {
  if (!writer) return;
  PCMWriterStop(writer);
  close(writer->wake[0]);
  close(writer->wake[1]);
  free(writer);
}
