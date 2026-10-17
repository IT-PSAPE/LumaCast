# Stream Windows process audio helper

This standalone .NET 8 helper lists visible interactive processes and captures a selected process tree with Windows WASAPI process loopback. It has no third-party NuGet dependencies and is built as a self-contained Windows x64 executable.

```powershell
dotnet publish AudioLoopback.csproj -c Release -r win-x64
```

The executable is written to `bin/Release/net8.0-windows10.0.20348.0/win-x64/publish/AudioLoopback.exe`.

CLI contract:

- `AudioLoopback.exe list` writes a JSON array of `{ "pid": number, "name": string, "path": string }` entries to stdout.
- `AudioLoopback.exe capture --pid <pid> --path <expected-executable-path>` writes raw interleaved stereo float32 little-endian PCM at 48 kHz to stdout. Supply the executable path returned by `list`. The helper checks the path before activation and revalidates the live process image after WASAPI activation before writing any PCM, preventing a stale or reused PID from capturing a different application. Capture ends when stdin reaches EOF or the selected process exits. Diagnostics go to stderr.

Process capture uses the Windows process-loopback activation API, available on Windows build 20348 and newer. Older systems can list applications but capture exits with an unsupported-version diagnostic. The native capture path requires a real Windows 11 / Windows Server 2022 or newer host for runtime verification; a Windows 10 build 19045 host can only verify the rejection path.

Run the dependency-free contract smoke checks with `powershell -ExecutionPolicy Bypass -File .\smoke-test.ps1` from this directory.
