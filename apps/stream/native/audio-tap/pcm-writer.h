#ifndef STREAM_PCM_WRITER_H
#define STREAM_PCM_WRITER_H

#include <stdbool.h>
#include <stddef.h>

// The queue holds at most 250 ms of 48 kHz stereo float32 PCM. Kernel pipe
// buffering is separate; no-progress timeout applies only while this queue has data.
enum {
  PCMWriterFrameBytes = 2 * 4,
  PCMWriterLatencyMilliseconds = 250,
  PCMWriterCapacityBytes = 48000 * PCMWriterFrameBytes * PCMWriterLatencyMilliseconds / 1000,
};

typedef enum {
  PCMWriterRunning,
  PCMWriterStopped,
  PCMWriterOverflow,
  PCMWriterStalled,
  PCMWriterParentClosed,
  PCMWriterWriteError,
  PCMWriterInvalidInput,
} PCMWriterState;

typedef struct PCMWriter PCMWriter;
// Called at most once on the output worker. Schedule owner teardown elsewhere;
// do not stop/destroy the writer from this callback.
typedef void (*PCMWriterFailure)(PCMWriterState state, int errorNumber, void *context);

// Borrows outputFD: keep it open until Stop returns. Restores its original flags
// on failure or stop and never closes it. NULL reports creation failure via errno.
// Caller owns SIGPIPE handling: ignore or block it to receive EPIPE failures.
PCMWriter *PCMWriterCreate(int outputFD, PCMWriterFailure onFailure, void *context);

// One serial producer; never waits for the reader or takes a mutex. Admits whole
// stereo frames/blocks or fails terminally. Healthy output is exact byte FIFO.
bool PCMWriterEnqueue(PCMWriter *writer, const void *bytes, size_t length);

// Serialized owner calls, safe alongside enqueue. Aborts pending PCM and joins
// the worker; no failure callback can run after this returns. Repeated stop is safe.
void PCMWriterStop(PCMWriter *writer);

// Requires the producer to be quiescent (CoreAudio IOProc destroyed) first.
void PCMWriterDestroy(PCMWriter *writer);

#endif
