// LumaStream macOS audio helper.
//
// Mirrors the Windows AudioLoopback.exe contract so the Electron main process can
// drive both with the same code:
//   list                                   -> JSON [{ "pid", "name", "path" }] on stdout
//   capture --pid <pid> --path <exe path>  -> raw 48 kHz stereo float32 LE PCM on stdout
//   capture --system                       -> same PCM for the whole system mix,
//                                             excluding LumaStream's own playback
// Capture ends when stdin reaches EOF or the selected process exits. Diagnostics
// go to stderr. Process taps need macOS 14.2 and the "System Audio Recording Only"
// privacy permission.
//
// Built with plain clang (no Swift runtime, no third-party code):
//   clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -arch arm64 -arch x86_64 main.m \
//     -framework Foundation -framework AppKit -framework CoreAudio -framework AVFoundation \
//     -o build/lumastream-audio-tap

#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>
#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdatomic.h>
#include <unistd.h>

static NSString *const kFailureDomain = @"lumastream.audio-tap";
static const double kOutputSampleRate = 48000.0;
static const AVAudioChannelCount kOutputChannels = 2;

enum {
  ExitFailure = 1,
  ExitUsage = 2,
  ExitUnsupportedSystem = 3,
  ExitPermissionRefused = 4,
};

static void WriteStderr(NSString *message) {
  fputs([[message stringByAppendingString:@"\n"] UTF8String], stderr);
  fflush(stderr);
}

static NSError *Failure(int exitCode, NSString *message) {
  return [NSError errorWithDomain:kFailureDomain code:exitCode userInfo:@{ NSLocalizedDescriptionKey: message }];
}

#pragma mark - Process enumeration

static NSArray<NSNumber *> *AllProcessIdentifiers(void) {
  int count = proc_listallpids(NULL, 0);
  if (count <= 0) return @[];
  size_t capacity = (size_t)count + 64;
  pid_t *pids = calloc(capacity, sizeof(pid_t));
  count = proc_listallpids(pids, (int)(capacity * sizeof(pid_t)));
  NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:(NSUInteger)MAX(count, 0)];
  for (int index = 0; index < count; index += 1) {
    if (pids[index] > 0) [result addObject:@(pids[index])];
  }
  free(pids);
  return result;
}

static pid_t ParentProcessIdentifier(pid_t pid) {
  struct proc_bsdinfo info;
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != (int)sizeof info) return -1;
  return (pid_t)info.pbi_ppid;
}

/// The process plus every live descendant, so browser and game audio-service children are included.
static NSSet<NSNumber *> *ProcessTree(pid_t root) {
  NSMutableDictionary<NSNumber *, NSMutableArray<NSNumber *> *> *childrenByParent = [NSMutableDictionary dictionary];
  for (NSNumber *pid in AllProcessIdentifiers()) {
    pid_t parent = ParentProcessIdentifier((pid_t)pid.intValue);
    if (parent < 0) continue;
    NSMutableArray<NSNumber *> *children = childrenByParent[@(parent)];
    if (!children) {
      children = [NSMutableArray array];
      childrenByParent[@(parent)] = children;
    }
    [children addObject:pid];
  }
  NSMutableSet<NSNumber *> *tree = [NSMutableSet setWithObject:@(root)];
  NSMutableArray<NSNumber *> *queue = [NSMutableArray arrayWithObject:@(root)];
  while (queue.count > 0) {
    NSNumber *next = queue.lastObject;
    [queue removeLastObject];
    for (NSNumber *child in childrenByParent[next] ?: @[]) {
      if ([tree containsObject:child]) continue;
      [tree addObject:child];
      [queue addObject:child];
    }
  }
  return tree;
}

static NSString *ExecutablePath(pid_t pid) {
  char buffer[PROC_PIDPATHINFO_MAXSIZE];
  int length = proc_pidpath(pid, buffer, sizeof buffer);
  return length > 0 ? [NSString stringWithUTF8String:buffer] : nil;
}

static BOOL ProcessIsAlive(pid_t pid) {
  if (kill(pid, 0) == 0) return YES;
  return errno != ESRCH;
}

static NSString *CanonicalPath(NSString *path) {
  return [[[NSURL fileURLWithPath:path] URLByStandardizingPath] URLByResolvingSymlinksInPath].path;
}

static BOOL PathsMatch(NSString *actual, NSString *expected) {
  return [CanonicalPath(actual) isEqualToString:CanonicalPath(expected)];
}

#pragma mark - list

static int ListApplications(void) {
  pid_t selfPid = getpid();
  NSMutableArray<NSDictionary *> *entries = [NSMutableArray array];
  for (NSRunningApplication *application in [NSWorkspace sharedWorkspace].runningApplications) {
    if (application.activationPolicy == NSApplicationActivationPolicyProhibited || application.processIdentifier == selfPid || application.terminated) continue;
    NSString *executable = application.executableURL.path;
    if (executable.length == 0 || ![executable hasPrefix:@"/"]) continue;
    // Menu-bar (accessory) apps are listed unless they are macOS's own agents (Dock, Control Centre, ...),
    // matching the Windows helper's exclusion of system processes.
    if (application.activationPolicy == NSApplicationActivationPolicyAccessory
        && ([executable hasPrefix:@"/System/"] || [executable hasPrefix:@"/usr/"])) continue;
    NSString *name = application.localizedName
      ?: application.bundleURL.URLByDeletingPathExtension.lastPathComponent
      ?: [NSURL fileURLWithPath:executable].lastPathComponent;
    [entries addObject:@{ @"pid": @(application.processIdentifier), @"name": name, @"path": executable }];
  }
  [entries sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    NSComparisonResult order = [left[@"name"] localizedCaseInsensitiveCompare:right[@"name"]];
    if (order != NSOrderedSame) return order;
    return [left[@"pid"] compare:right[@"pid"]];
  }];
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:entries options:0 error:&error];
  if (!json) {
    WriteStderr([NSString stringWithFormat:@"Could not encode the application list: %@", error.localizedDescription]);
    return ExitFailure;
  }
  fwrite(json.bytes, 1, json.length, stdout);
  fflush(stdout);
  return 0;
}

#pragma mark - Core Audio helpers

static NSString *CoreAudioMessage(OSStatus status) {
  uint32_t code = CFSwapInt32HostToBig((uint32_t)status);
  const unsigned char *bytes = (const unsigned char *)&code;
  BOOL printable = YES;
  for (int index = 0; index < 4; index += 1) printable = printable && bytes[index] >= 0x20 && bytes[index] < 0x7f;
  if (printable) return [NSString stringWithFormat:@"'%c%c%c%c' (%d)", bytes[0], bytes[1], bytes[2], bytes[3], (int)status];
  return [NSString stringWithFormat:@"%d", (int)status];
}

static NSError *CheckStatus(OSStatus status, NSString *operation) {
  if (status == noErr) return nil;
  if (status == kAudioHardwareIllegalOperationError || status == kAudioHardwareNotRunningError || status == 1852797029 /* 'nope' */) {
    return Failure(ExitPermissionRefused, [NSString stringWithFormat:
      @"%@ was refused by macOS (%@). Allow LumaStream under System Settings › Privacy & Security › Screen & System Audio Recording, then try again.",
      operation, CoreAudioMessage(status)]);
  }
  return Failure(ExitFailure, [NSString stringWithFormat:@"%@ failed: %@.", operation, CoreAudioMessage(status)]);
}

static AudioObjectPropertyAddress GlobalAddress(AudioObjectPropertySelector selector) {
  return (AudioObjectPropertyAddress){ selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
}

static AudioObjectID ProcessObjectForPid(pid_t pid) {
  AudioObjectPropertyAddress address = GlobalAddress(kAudioHardwarePropertyTranslatePIDToProcessObject);
  AudioObjectID object = kAudioObjectUnknown;
  UInt32 size = sizeof object;
  OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, sizeof pid, &pid, &size, &object);
  return status == noErr ? object : kAudioObjectUnknown;
}

/// Audio process objects for the given PIDs; processes that have not opened audio yet have none and are skipped.
static NSArray<NSNumber *> *ProcessObjectsForPids(NSSet<NSNumber *> *pids) {
  NSArray<NSNumber *> *sorted = [pids.allObjects sortedArrayUsingSelector:@selector(compare:)];
  NSMutableArray<NSNumber *> *objects = [NSMutableArray array];
  for (NSNumber *pid in sorted) {
    AudioObjectID object = ProcessObjectForPid((pid_t)pid.intValue);
    if (object != kAudioObjectUnknown) [objects addObject:@(object)];
  }
  return objects;
}

static NSString *DefaultOutputDeviceUID(NSError **error) {
  AudioObjectPropertyAddress address = GlobalAddress(kAudioHardwarePropertyDefaultSystemOutputDevice);
  AudioObjectID device = kAudioObjectUnknown;
  UInt32 size = sizeof device;
  if ((*error = CheckStatus(AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, &device), @"Finding the default output device"))) return nil;
  AudioObjectPropertyAddress uidAddress = GlobalAddress(kAudioDevicePropertyDeviceUID);
  CFStringRef uid = NULL;
  UInt32 uidSize = sizeof uid;
  if ((*error = CheckStatus(AudioObjectGetPropertyData(device, &uidAddress, 0, NULL, &uidSize, &uid), @"Reading the default output device"))) return nil;
  return (__bridge_transfer NSString *)uid;
}

#pragma mark - Tap session

typedef CATapDescription *(^TapDescriptionBuilder)(void);

API_AVAILABLE(macos(14.2))
@interface TapSession : NSObject
- (instancetype)initWithDescriptionBuilder:(TapDescriptionBuilder)builder onFailure:(void (^)(NSError *))onFailure;
- (BOOL)startWithError:(NSError **)error;
- (void)stop;
@end

@implementation TapSession {
  TapDescriptionBuilder _builder;
  void (^_onFailure)(NSError *);
  AudioObjectID _tapID;
  AudioObjectID _aggregateID;
  AudioDeviceIOProcID _ioProcID;
  AVAudioFormat *_inputFormat;
  AVAudioFormat *_outputFormat;
  AVAudioConverter *_converter;
  dispatch_queue_t _writeQueue;
  dispatch_source_t _refreshTimer;
  NSArray<NSNumber *> *_currentProcesses;
  atomic_bool _stopped;
}

- (instancetype)initWithDescriptionBuilder:(TapDescriptionBuilder)builder onFailure:(void (^)(NSError *))onFailure {
  if ((self = [super init])) {
    _builder = [builder copy];
    _onFailure = [onFailure copy];
    _tapID = kAudioObjectUnknown;
    _aggregateID = kAudioObjectUnknown;
    _outputFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:kOutputSampleRate channels:kOutputChannels interleaved:YES];
    _writeQueue = dispatch_queue_create("lumastream.audio-tap.write", DISPATCH_QUEUE_SERIAL);
    atomic_init(&_stopped, false);
  }
  return self;
}

- (CATapDescription *)buildDescription {
  CATapDescription *description = _builder();
  description.privateTap = YES;
  description.muteBehavior = CATapUnmuted;
  return description;
}

- (BOOL)startWithError:(NSError **)error {
  CATapDescription *description = [self buildDescription];
  _currentProcesses = description.processes ?: @[];
  if ((*error = CheckStatus(AudioHardwareCreateProcessTap(description, &_tapID), @"Creating the audio tap"))) return NO;

  AudioObjectPropertyAddress formatAddress = GlobalAddress(kAudioTapPropertyFormat);
  AudioStreamBasicDescription streamDescription = {0};
  UInt32 formatSize = sizeof streamDescription;
  if ((*error = CheckStatus(AudioObjectGetPropertyData(_tapID, &formatAddress, 0, NULL, &formatSize, &streamDescription), @"Reading the tap format"))) return NO;
  _inputFormat = [[AVAudioFormat alloc] initWithStreamDescription:&streamDescription];
  if (!_inputFormat) {
    *error = Failure(ExitFailure, @"The audio tap reported an unsupported stream format.");
    return NO;
  }
  _converter = [[AVAudioConverter alloc] initFromFormat:_inputFormat toFormat:_outputFormat];
  if (!_converter) {
    *error = Failure(ExitFailure, [NSString stringWithFormat:@"The tap format (%d Hz, %u channels) cannot be converted to 48 kHz stereo.", (int)_inputFormat.sampleRate, _inputFormat.channelCount]);
    return NO;
  }

  NSString *outputUID = DefaultOutputDeviceUID(error);
  if (!outputUID) return NO;
  NSDictionary *aggregateDescription = @{
    @kAudioAggregateDeviceNameKey: @"LumaStream Audio Tap",
    @kAudioAggregateDeviceUIDKey: [NSUUID UUID].UUIDString,
    @kAudioAggregateDeviceMainSubDeviceKey: outputUID,
    @kAudioAggregateDeviceIsPrivateKey: @YES,
    @kAudioAggregateDeviceIsStackedKey: @NO,
    @kAudioAggregateDeviceTapAutoStartKey: @YES,
    @kAudioAggregateDeviceSubDeviceListKey: @[ @{ @kAudioSubDeviceUIDKey: outputUID } ],
    @kAudioAggregateDeviceTapListKey: @[ @{ @kAudioSubTapDriftCompensationKey: @YES, @kAudioSubTapUIDKey: description.UUID.UUIDString } ],
  };
  if ((*error = CheckStatus(AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregateDescription, &_aggregateID), @"Creating the capture device"))) return NO;

  dispatch_queue_t ioQueue = dispatch_queue_create("lumastream.audio-tap.io", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
  __weak TapSession *weakSelf = self;
  OSStatus status = AudioDeviceCreateIOProcIDWithBlock(&_ioProcID, _aggregateID, ioQueue,
    ^(const AudioTimeStamp *inNow, const AudioBufferList *inInputData, const AudioTimeStamp *inInputTime, AudioBufferList *outOutputData, const AudioTimeStamp *inOutputTime) {
      [weakSelf handleInput:inInputData];
    });
  if ((*error = CheckStatus(status, @"Attaching the capture callback"))) return NO;
  if ((*error = CheckStatus(AudioDeviceStart(_aggregateID, _ioProcID), @"Starting the capture device"))) return NO;

  _refreshTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_queue_create("lumastream.audio-tap.refresh", DISPATCH_QUEUE_SERIAL));
  dispatch_source_set_timer(_refreshTimer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
  dispatch_source_set_event_handler(_refreshTimer, ^{ [weakSelf refreshProcesses]; });
  dispatch_resume(_refreshTimer);
  return YES;
}

/// Keeps the tap following processes that start or stop after capture began (browser audio services, game launchers).
- (void)refreshProcesses {
  if (atomic_load(&_stopped)) return;
  CATapDescription *description = [self buildDescription];
  NSArray<NSNumber *> *processes = description.processes ?: @[];
  if ([processes isEqualToArray:_currentProcesses]) return;
  AudioObjectPropertyAddress address = GlobalAddress(kAudioTapPropertyDescription);
  CFTypeRef reference = (__bridge CFTypeRef)description;
  OSStatus status = AudioObjectSetPropertyData(_tapID, &address, 0, NULL, sizeof reference, &reference);
  if (status == noErr) {
    _currentProcesses = processes;
  } else {
    WriteStderr([NSString stringWithFormat:@"Could not update the tapped process list: %@.", CoreAudioMessage(status)]);
  }
}

- (void)handleInput:(const AudioBufferList *)inputData {
  if (atomic_load(&_stopped) || !_inputFormat || !_converter || inputData->mNumberBuffers == 0) return;
  UInt32 bytesPerFrame = MAX(1u, _inputFormat.streamDescription->mBytesPerFrame);
  AVAudioFrameCount frameCount = inputData->mBuffers[0].mDataByteSize / bytesPerFrame;
  if (frameCount == 0) return;
  AVAudioPCMBuffer *inputBuffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:_inputFormat bufferListNoCopy:inputData deallocator:nil];
  if (!inputBuffer) return;
  inputBuffer.frameLength = frameCount;
  double ratio = _outputFormat.sampleRate / _inputFormat.sampleRate;
  AVAudioFrameCount capacity = (AVAudioFrameCount)((double)frameCount * ratio) + 64;
  AVAudioPCMBuffer *outputBuffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:_outputFormat frameCapacity:capacity];
  if (!outputBuffer) return;
  __block BOOL consumed = NO;
  NSError *conversionError = nil;
  AVAudioConverterOutputStatus status = [_converter convertToBuffer:outputBuffer error:&conversionError
    withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount inNumberOfPackets, AVAudioConverterInputStatus *outStatus) {
      if (consumed) {
        *outStatus = AVAudioConverterInputStatus_NoDataNow;
        return nil;
      }
      consumed = YES;
      *outStatus = AVAudioConverterInputStatus_HaveData;
      return inputBuffer;
    }];
  if (status == AVAudioConverterOutputStatus_Error) {
    [self failWith:Failure(ExitFailure, [NSString stringWithFormat:@"Audio conversion failed: %@.", conversionError.localizedDescription ?: @"unknown error"])];
    return;
  }
  if (outputBuffer.frameLength == 0 || !outputBuffer.floatChannelData) return;
  NSUInteger byteCount = outputBuffer.frameLength * _outputFormat.streamDescription->mBytesPerFrame;
  NSData *data = [NSData dataWithBytes:outputBuffer.floatChannelData[0] length:byteCount];
  __weak TapSession *weakSelf = self;
  dispatch_async(_writeQueue, ^{ [weakSelf writeData:data]; });
}

- (void)writeData:(NSData *)data {
  if (atomic_load(&_stopped)) return;
  const uint8_t *bytes = data.bytes;
  NSUInteger offset = 0;
  while (offset < data.length) {
    ssize_t written = write(STDOUT_FILENO, bytes + offset, data.length - offset);
    if (written < 0) {
      if (errno == EINTR || errno == EAGAIN) continue;
      // The parent closed its end: a clean shutdown, not an error.
      [self failWith:Failure(0, @"")];
      return;
    }
    offset += (NSUInteger)written;
  }
}

- (void)failWith:(NSError *)error {
  if (atomic_load(&_stopped)) return;
  _onFailure(error);
}

- (void)stop {
  bool expected = false;
  if (!atomic_compare_exchange_strong(&_stopped, &expected, true)) return;
  if (_refreshTimer) {
    dispatch_source_cancel(_refreshTimer);
    _refreshTimer = nil;
  }
  if (_aggregateID != kAudioObjectUnknown) {
    if (_ioProcID) {
      AudioDeviceStop(_aggregateID, _ioProcID);
      AudioDeviceDestroyIOProcID(_aggregateID, _ioProcID);
      _ioProcID = NULL;
    }
    AudioHardwareDestroyAggregateDevice(_aggregateID);
    _aggregateID = kAudioObjectUnknown;
  }
  if (_tapID != kAudioObjectUnknown) {
    AudioHardwareDestroyProcessTap(_tapID);
    _tapID = kAudioObjectUnknown;
  }
}

@end

#pragma mark - capture

static NSError *UnsupportedSystemError(void) {
  NSOperatingSystemVersion version = [NSProcessInfo processInfo].operatingSystemVersion;
  return Failure(ExitUnsupportedSystem, [NSString stringWithFormat:@"Audio capture requires macOS 14.2 or later. This Mac runs %ld.%ld.%ld.",
    (long)version.majorVersion, (long)version.minorVersion, (long)version.patchVersion]);
}

static int ExitWithError(NSError *error) {
  if (error.localizedDescription.length > 0) WriteStderr(error.localizedDescription);
  return (int)error.code;
}

static int RunCapture(TapDescriptionBuilder builder, pid_t watchedProcess, NSString *banner) {
  if (@available(macOS 14.2, *)) {
    signal(SIGPIPE, SIG_IGN);
    NSLock *finishLock = [[NSLock alloc] init];
    __block BOOL finished = NO;
    __block TapSession *session = nil;
    void (^finish)(NSError *) = ^(NSError *error) {
      [finishLock lock];
      if (finished) {
        [finishLock unlock];
        return;
      }
      finished = YES;
      [session stop];
      [finishLock unlock];
      if (error.localizedDescription.length > 0) WriteStderr(error.localizedDescription);
      exit(error ? (int)error.code : 0);
    };
    session = [[TapSession alloc] initWithDescriptionBuilder:builder onFailure:finish];
    NSError *error = nil;
    if (![session startWithError:&error]) {
      [session stop];
      return ExitWithError(error);
    }
    WriteStderr(banner);

    // Stop when the parent closes our stdin.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      uint8_t byte = 0;
      for (;;) {
        ssize_t count = read(STDIN_FILENO, &byte, 1);
        if (count > 0) continue;
        if (count < 0 && (errno == EINTR || errno == EAGAIN)) continue;
        finish(nil);
        return;
      }
    });

    // Stop when the tapped application exits.
    if (watchedProcess > 0) {
      dispatch_source_t processSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, (uintptr_t)watchedProcess, DISPATCH_PROC_EXIT, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
      dispatch_source_set_event_handler(processSource, ^{ finish(nil); });
      dispatch_resume(processSource);
      if (!ProcessIsAlive(watchedProcess)) finish(nil);
      // Keep the source alive for the lifetime of dispatch_main().
      static dispatch_source_t retainedSource;
      retainedSource = processSource;
      (void)retainedSource;
    }
    dispatch_main();
  }
  return ExitWithError(UnsupportedSystemError());
}

static int CaptureApplication(pid_t pid, NSString *expectedPath) {
  if (pid <= 1 || pid == getpid()) return ExitWithError(Failure(ExitUsage, @"The requested PID is not a capturable user process."));
  if (!ProcessIsAlive(pid)) return ExitWithError(Failure(ExitUsage, [NSString stringWithFormat:@"Process %d does not exist.", (int)pid]));
  NSString *path = ExecutablePath(pid);
  if (path.length == 0) return ExitWithError(Failure(ExitUsage, @"The process executable path is unavailable; capture requires a readable user process."));
  if (!PathsMatch(path, expectedPath)) {
    return ExitWithError(Failure(ExitUsage, @"The process executable path does not match the selected application. Refresh the application list and try again."));
  }
  if (@available(macOS 14.2, *)) {
    TapDescriptionBuilder builder = ^CATapDescription *{
      return [[CATapDescription alloc] initStereoMixdownOfProcesses:ProcessObjectsForPids(ProcessTree(pid))];
    };
    return RunCapture(builder, pid, [NSString stringWithFormat:@"Capturing %@ (PID %d) as 48 kHz stereo float PCM.", path.lastPathComponent, (int)pid]);
  }
  return ExitWithError(UnsupportedSystemError());
}

/// The Electron process that owns this helper. When the direct parent is a helper inside the same
/// .app bundle as its own parent (Electron's main process), the bundle root is used so every
/// LumaStream process is excluded from the system mix.
static pid_t HostProcessRoot(pid_t pid) {
  pid_t parent = ParentProcessIdentifier(pid);
  if (parent <= 1) return -1;
  pid_t grandparent = ParentProcessIdentifier(parent);
  if (grandparent <= 1) return parent;
  NSString *parentPath = ExecutablePath(parent);
  NSString *grandparentPath = ExecutablePath(grandparent);
  NSString *marker = @".app/Contents/";
  if (!parentPath || !grandparentPath || ![parentPath containsString:marker] || ![grandparentPath containsString:marker]) return parent;
  NSString *parentBundle = [parentPath componentsSeparatedByString:marker][0];
  NSString *grandparentBundle = [grandparentPath componentsSeparatedByString:marker][0];
  return [parentBundle isEqualToString:grandparentBundle] ? grandparent : parent;
}

static int CaptureSystem(void) {
  if (@available(macOS 14.2, *)) {
    // Exclude LumaStream itself (the helper's parent Electron process and all of its children) so
    // monitored program audio is not captured a second time.
    pid_t hostRoot = HostProcessRoot(getpid());
    TapDescriptionBuilder builder = ^CATapDescription *{
      NSArray<NSNumber *> *excluded = hostRoot > 0 ? ProcessObjectsForPids(ProcessTree(hostRoot)) : @[];
      return [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:excluded];
    };
    return RunCapture(builder, 0, @"Capturing the system audio mix as 48 kHz stereo float PCM.");
  }
  return ExitWithError(UnsupportedSystemError());
}

#pragma mark - Entry point

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSMutableArray<NSString *> *arguments = [NSMutableArray array];
    for (int index = 1; index < argc; index += 1) [arguments addObject:[NSString stringWithUTF8String:argv[index]]];
    if (arguments.count == 1 && [arguments[0] isEqualToString:@"list"]) return ListApplications();
    if (arguments.count == 2 && [arguments[0] isEqualToString:@"capture"] && [arguments[1] isEqualToString:@"--system"]) return CaptureSystem();
    if (arguments.count == 5 && [arguments[0] isEqualToString:@"capture"] && [arguments[1] isEqualToString:@"--pid"] && [arguments[3] isEqualToString:@"--path"]) {
      NSScanner *scanner = [NSScanner scannerWithString:arguments[2]];
      int pid = 0;
      NSString *expectedPath = [arguments[4] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
      if ([scanner scanInt:&pid] && scanner.atEnd && expectedPath.length > 0) return CaptureApplication((pid_t)pid, arguments[4]);
    }
    return ExitWithError(Failure(ExitUsage, @"Usage: lumastream-audio-tap list | capture --pid <pid> --path <expected-executable-path> | capture --system"));
  }
}
