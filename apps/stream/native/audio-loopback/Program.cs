using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    private const int RequiredWindowsBuild = 20348;
    private static readonly HashSet<string> SystemProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "audiodg", "csrss", "ctfmon", "dwm", "fontdrvhost", "lsass", "services", "smss",
        "spoolsv", "svchost", "System", "taskhostw", "TextInputHost", "wininit", "winlogon", "WUDFHost",
    };

    [MTAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows())
            {
                throw new CliException("This helper only runs on Windows.", 2);
            }

            if (args.Length == 1 && args[0] == "list")
            {
                WriteProcessList();
                return 0;
            }

            if (args.Length == 5 && args[0] == "capture" && args[1] == "--pid" &&
                int.TryParse(args[2], out var pid) && args[3] == "--path" && !string.IsNullOrWhiteSpace(args[4]))
            {
                Capture(pid, args[4]);
                return 0;
            }

            throw new CliException("Usage: audio-loopback.exe list | capture --pid <pid> --path <expected-executable-path>", 2);
        }
        catch (CliException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return exception.ExitCode;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Audio loopback failed: {exception.Message}");
            return 1;
        }
    }

    private static void WriteProcessList()
    {
        var visibleProcessIds = WindowsNative.GetVisibleWindowProcessIds();
        var processes = new List<ProcessEntry>();
        foreach (var pid in visibleProcessIds)
        {
            if (pid <= 4 || pid == Environment.ProcessId)
            {
                continue;
            }

            try
            {
                using var process = Process.GetProcessById(pid);
                if (process.SessionId != Process.GetCurrentProcess().SessionId)
                {
                    continue;
                }

                var path = WindowsNative.TryGetExecutablePath(process.Handle);
                if (string.IsNullOrWhiteSpace(path))
                {
                    continue;
                }

                var name = Path.GetFileNameWithoutExtension(path);
                if (!SystemProcessNames.Contains(name))
                {
                    processes.Add(new ProcessEntry(pid, name, path));
                }
            }
            catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or
                                                System.ComponentModel.Win32Exception or UnauthorizedAccessException)
            {
                // Processes can exit or deny path access while the list is being read.
            }
        }

        processes.Sort(static (left, right) =>
        {
            var nameOrder = StringComparer.OrdinalIgnoreCase.Compare(left.Name, right.Name);
            return nameOrder != 0 ? nameOrder : left.Pid.CompareTo(right.Pid);
        });
        Console.Out.Write(JsonSerializer.Serialize(processes));
    }

    private static void Capture(int pid, string expectedPath)
    {
        if (pid <= 4 || pid == Environment.ProcessId)
        {
            throw new CliException("The requested PID is not a capturable user process.", 2);
        }

        Process target;
        try
        {
            target = Process.GetProcessById(pid);
            if (target.HasExited)
            {
                target.Dispose();
                throw new CliException($"Process {pid} has already exited.", 2);
            }
        }
        catch (ArgumentException)
        {
            throw new CliException($"Process {pid} does not exist.", 2);
        }

        using (target)
        {
            if (target.SessionId != Process.GetCurrentProcess().SessionId)
            {
                throw new CliException("Capture is limited to processes in the current interactive session.", 2);
            }

            var path = WindowsNative.TryGetExecutablePath(target.Handle);
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new CliException("The process executable path is unavailable; capture requires a readable user process.", 2);
            }

            if (!PathsMatch(path, expectedPath))
            {
                throw new CliException("The process executable path does not match the selected application. Refresh the application list and try again.", 2);
            }

            var osVersion = Environment.OSVersion.Version;
            if (osVersion.Build < RequiredWindowsBuild)
            {
                throw new CliException(
                    $"Process audio capture requires Windows build {RequiredWindowsBuild} or later. This host is build {osVersion.Build}.",
                    3);
            }

            using var capture = WasapiProcessLoopback.Start(pid);
            using var liveTarget = GetValidatedLiveTarget(pid, expectedPath);
            Console.Error.WriteLine($"Capturing {Path.GetFileName(path)} (PID {pid}) as 48 kHz stereo float PCM.");

            var stdout = Console.OpenStandardOutput();
            var stopSignal = new CancellationTokenSource();
            _ = MonitorInputAsync(stopSignal);
            try
            {
                capture.CopyTo(stdout, stopSignal.Token);
                stdout.Flush();
            }
            finally
            {
                stopSignal.Cancel();
            }
        }
    }

    private static Process GetValidatedLiveTarget(int pid, string expectedPath)
    {
        Process liveTarget;
        try
        {
            liveTarget = Process.GetProcessById(pid);
        }
        catch (ArgumentException)
        {
            throw new CliException($"Process {pid} exited during audio capture setup.", 2);
        }

        try
        {
            if (liveTarget.HasExited)
            {
                throw new CliException($"Process {pid} exited during audio capture setup.", 2);
            }

            if (liveTarget.SessionId != Process.GetCurrentProcess().SessionId)
            {
                throw new CliException("The target process changed to a different interactive session during capture setup.", 2);
            }

            var livePath = WindowsNative.TryGetExecutablePath(liveTarget.Handle);
            if (string.IsNullOrWhiteSpace(livePath) || !PathsMatch(livePath, expectedPath))
            {
                throw new CliException("The process executable changed during capture setup. No audio was emitted; refresh the application list and try again.", 2);
            }

            return liveTarget;
        }
        catch
        {
            liveTarget.Dispose();
            throw;
        }
    }

    private static bool PathsMatch(string actualPath, string expectedPath)
    {
        try
        {
            return StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(actualPath), Path.GetFullPath(expectedPath));
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (NotSupportedException)
        {
            return false;
        }
    }

    private static async Task MonitorInputAsync(CancellationTokenSource stopSignal)
    {
        var buffer = new byte[1];
        try
        {
            var input = Console.OpenStandardInput();
            while (!stopSignal.IsCancellationRequested)
            {
                if (await input.ReadAsync(buffer.AsMemory(), stopSignal.Token) == 0)
                {
                    stopSignal.Cancel();
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (IOException exception)
        {
            Console.Error.WriteLine($"Could not monitor stdin: {exception.Message}");
            stopSignal.Cancel();
        }
    }

    private sealed record ProcessEntry(
        [property: JsonPropertyName("pid")] int Pid,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("path")] string Path);

    private sealed class CliException(string message, int exitCode) : Exception(message)
    {
        public int ExitCode { get; } = exitCode;
    }
}

internal sealed class WasapiProcessLoopback : IDisposable
{
    private const uint StreamFlagsLoopback = 0x00020000;
    private const uint StreamFlagsEventCallback = 0x00040000;
    private const uint StreamFlagsAutoConvertPcm = 0x80000000;
    private const uint StreamFlagsSrcDefaultQuality = 0x08000000;
    private const uint BufferFlagSilent = 0x00000002;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private static readonly Guid AudioClientId = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid AudioCaptureClientId = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    private readonly IAudioClient audioClient;
    private readonly IAudioCaptureClient captureClient;
    private readonly SafeWaitHandle eventHandle;
    private readonly IntPtr processHandle;
    private readonly byte[] outputBuffer = new byte[64 * 1024];

    private WasapiProcessLoopback(IAudioClient audioClient, IAudioCaptureClient captureClient,
        SafeWaitHandle eventHandle, IntPtr processHandle)
    {
        this.audioClient = audioClient;
        this.captureClient = captureClient;
        this.eventHandle = eventHandle;
        this.processHandle = processHandle;
    }

    public static WasapiProcessLoopback Start(int pid)
    {
        var processHandle = WindowsNative.OpenProcess(WindowsNative.Synchronize | WindowsNative.ProcessQueryLimitedInformation, false, pid);
        if (processHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException($"Could not open process {pid}: {Marshal.GetLastWin32Error()}.");
        }

        var activationParams = Marshal.AllocHGlobal(12);
        var propVariant = Marshal.AllocHGlobal(IntPtr.Size == 8 ? 24 : 16);
        var activateEvent = new ManualResetEvent(false);
        var callback = new ActivationCallback(activateEvent);
        IAudioClient? audioClient = null;
        IAudioCaptureClient? captureClient = null;
        SafeWaitHandle? eventHandle = null;
        try
        {
            Marshal.WriteInt32(activationParams, 1); // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            Marshal.WriteInt32(activationParams, 4, pid);
            Marshal.WriteInt32(activationParams, 8, 0); // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE

            for (var i = 0; i < (IntPtr.Size == 8 ? 24 : 16); i++)
            {
                Marshal.WriteByte(propVariant, i, 0);
            }
            Marshal.WriteInt16(propVariant, 0, 0x41); // VT_BLOB
            Marshal.WriteInt32(propVariant, 8, 12);
            Marshal.WriteIntPtr(propVariant, IntPtr.Size == 8 ? 16 : 12, activationParams);

            var clientId = AudioClientId;
            var hr = WindowsNative.ActivateAudioInterfaceAsync(
                "VAD\\Process_Loopback",
                ref clientId,
                propVariant,
                callback,
                out var operation);
            Marshal.ThrowExceptionForHR(hr);

            if (!activateEvent.WaitOne(TimeSpan.FromSeconds(10)))
            {
                Marshal.ReleaseComObject(operation);
                throw new TimeoutException("Windows audio activation timed out.");
            }

            audioClient = callback.TakeClient();
            Marshal.ReleaseComObject(operation);

            var format = new WaveFormatEx
            {
                FormatTag = 3,
                Channels = 2,
                SamplesPerSec = 48_000,
                AvgBytesPerSec = 384_000,
                BlockAlign = 8,
                BitsPerSample = 32,
                ExtraSize = 0,
            };
            var formatPointer = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
            Marshal.StructureToPtr(format, formatPointer, false);
            try
            {
                hr = audioClient.Initialize(0, StreamFlagsLoopback | StreamFlagsEventCallback |
                    StreamFlagsAutoConvertPcm | StreamFlagsSrcDefaultQuality, 0, 0,
                    formatPointer, IntPtr.Zero);
                Marshal.ThrowExceptionForHR(hr);
            }
            finally
            {
                Marshal.FreeHGlobal(formatPointer);
            }

            eventHandle = WindowsNative.CreateEvent(IntPtr.Zero, false, false, null);
            if (eventHandle.IsInvalid)
            {
                throw new InvalidOperationException($"Could not create the capture event: {Marshal.GetLastWin32Error()}.");
            }

            Marshal.ThrowExceptionForHR(audioClient.SetEventHandle(eventHandle.DangerousGetHandle()));
            var captureClientId = AudioCaptureClientId;
            Marshal.ThrowExceptionForHR(audioClient.GetService(ref captureClientId, out var service));
            captureClient = (IAudioCaptureClient)service;
            Marshal.ThrowExceptionForHR(audioClient.Start());

            return new WasapiProcessLoopback(audioClient, captureClient, eventHandle, processHandle);
        }
        catch
        {
            if (captureClient is not null) Marshal.ReleaseComObject(captureClient);
            if (audioClient is not null) Marshal.ReleaseComObject(audioClient);
            eventHandle?.Dispose();
            WindowsNative.CloseHandle(processHandle);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(propVariant);
            Marshal.FreeHGlobal(activationParams);
            activateEvent.Dispose();
        }
    }

    public void CopyTo(Stream output, CancellationToken cancellationToken)
    {
        var handles = new[] { eventHandle.DangerousGetHandle(), processHandle };
        while (!cancellationToken.IsCancellationRequested)
        {
            var waitResult = WindowsNative.WaitForMultipleObjects(2, handles, false, 50);
            if (waitResult == WaitObject0 + 1)
            {
                return;
            }

            if (waitResult != WaitTimeout && waitResult != WaitObject0)
            {
                throw new InvalidOperationException($"Waiting for audio or target process failed: {Marshal.GetLastWin32Error()}.");
            }

            DrainPackets(output);
        }
    }

    private void DrainPackets(Stream output)
    {
        while (true)
        {
            Marshal.ThrowExceptionForHR(captureClient.GetNextPacketSize(out var frames));
            if (frames == 0)
            {
                return;
            }

            Marshal.ThrowExceptionForHR(captureClient.GetBuffer(out var data, out frames, out var flags,
                out _, out _));
            try
            {
                var byteCount = checked((int)frames * 8);
                if (byteCount > outputBuffer.Length)
                {
                    var chunk = new byte[byteCount];
                    WritePacket(data, flags, chunk, byteCount);
                    output.Write(chunk, 0, byteCount);
                }
                else
                {
                    WritePacket(data, flags, outputBuffer, byteCount);
                    output.Write(outputBuffer, 0, byteCount);
                }
            }
            finally
            {
                Marshal.ThrowExceptionForHR(captureClient.ReleaseBuffer(frames));
            }
        }
    }

    private static void WritePacket(IntPtr data, uint flags, byte[] destination, int byteCount)
    {
        if ((flags & BufferFlagSilent) != 0)
        {
            Array.Clear(destination, 0, byteCount);
            return;
        }

        Marshal.Copy(data, destination, 0, byteCount);
    }

    public void Dispose()
    {
        try { audioClient.Stop(); } catch { }
        Marshal.ReleaseComObject(captureClient);
        Marshal.ReleaseComObject(audioClient);
        eventHandle.Dispose();
        WindowsNative.CloseHandle(processHandle);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormatEx
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSec;
        public uint AvgBytesPerSec;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort ExtraSize;
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity,
            IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint bufferSize);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid interfaceId, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags,
            out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    private sealed class ActivationCallback(ManualResetEvent completed) : IActivateAudioInterfaceCompletionHandler
    {
        private IAudioClient? activated;
        private int result;

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            try
            {
                result = operation.GetActivateResult(out var activationResult, out var activatedObject);
                if (result >= 0)
                {
                    result = activationResult;
                    if (result >= 0)
                    {
                        activated = (IAudioClient)activatedObject;
                    }
                }
            }
            catch (Exception exception)
            {
                result = Marshal.GetHRForException(exception);
            }
            finally
            {
                completed.Set();
            }
        }

        public IAudioClient TakeClient()
        {
            Marshal.ThrowExceptionForHR(result);
            return activated is null
                ? throw new InvalidOperationException("Windows audio activation returned no client.")
                : Interlocked.Exchange(ref activated, null)!;
        }
    }

    [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activationResult,
            [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }
}

internal static class WindowsNative
{
    public const uint Synchronize = 0x00100000;
    public const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("mmdevapi.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int ActivateAudioInterfaceAsync(string deviceInterfacePath, ref Guid interfaceId,
        IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] WasapiProcessLoopback.IActivateAudioInterfaceCompletionHandler completionHandler,
        out WasapiProcessLoopback.IActivateAudioInterfaceAsyncOperation operation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern SafeWaitHandle CreateEvent(IntPtr attributes, bool manualReset, bool initialState, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForMultipleObjects(uint count, [In] IntPtr[] handles, bool waitAll, uint milliseconds);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProcedure callback, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);

    public static string? TryGetExecutablePath(IntPtr processHandle)
    {
        var path = new StringBuilder(32_768);
        uint size = (uint)path.Capacity;
        return QueryFullProcessImageName(processHandle, 0, path, ref size) ? path.ToString() : null;
    }

    public static HashSet<int> GetVisibleWindowProcessIds()
    {
        var processIds = new HashSet<int>();
        EnumWindows((window, _) =>
        {
            if (IsWindowVisible(window))
            {
                GetWindowThreadProcessId(window, out var pid);
                if (pid > 0) processIds.Add(pid);
            }
            return true;
        }, IntPtr.Zero);
        return processIds;
    }

    private delegate bool EnumWindowsProcedure(IntPtr window, IntPtr parameter);
}
