$ErrorActionPreference = 'Stop'

$project = Join-Path $PSScriptRoot 'AudioLoopback.csproj'
& dotnet publish $project --configuration Release --runtime win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) {
    throw "publish exited with code $LASTEXITCODE"
}
$exe = Join-Path $PSScriptRoot 'bin\Release\net8.0-windows10.0.20348.0\win-x64\publish\AudioLoopback.exe'
$listJson = (& $exe list | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "list exited with code $LASTEXITCODE"
}
$entries = ConvertFrom-Json -InputObject $listJson
foreach ($entry in $entries) {
    $parsedPid = 0
    if (-not [int]::TryParse([string]$entry.pid, [ref]$parsedPid) -or [string]::IsNullOrWhiteSpace($entry.name) -or
        [string]::IsNullOrWhiteSpace($entry.path) -or -not (Test-Path -LiteralPath $entry.path)) {
        throw "list returned an invalid process entry: $($entry | ConvertTo-Json -Compress)"
    }
}

$currentProcessPath = (Get-Process -Id $PID).Path
$mismatchStdout = Join-Path $env:TEMP 'stream-audio-loopback-mismatch-stdout.tmp'
$mismatchStderr = Join-Path $env:TEMP 'stream-audio-loopback-mismatch-stderr.tmp'
try {
    $mismatchProcess = Start-Process -FilePath $exe -ArgumentList @(
        'capture', '--pid', [string]$PID, '--path', 'C:\stream\wrong.exe'
    ) -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $mismatchStdout `
        -RedirectStandardError $mismatchStderr -Wait -PassThru
    $mismatchError = Get-Content -Raw $mismatchStderr
    if ($mismatchProcess.ExitCode -ne 2 -or (Get-Item $mismatchStdout).Length -ne 0 -or
        $mismatchError -notmatch 'does not match the selected application') {
        throw "executable path mismatch did not fail before capture (exit $($mismatchProcess.ExitCode)): $mismatchError"
    }
}
finally {
    Remove-Item -LiteralPath $mismatchStdout, $mismatchStderr -Force -ErrorAction SilentlyContinue
}

$invalidStdout = Join-Path $env:TEMP 'stream-audio-loopback-invalid-stdout.tmp'
$invalidStderr = Join-Path $env:TEMP 'stream-audio-loopback-invalid-stderr.tmp'
try {
    $invalidProcess = Start-Process -FilePath $exe -ArgumentList @('capture', '--pid', '0', '--path', $env:ComSpec) `
        -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $invalidStdout `
        -RedirectStandardError $invalidStderr -Wait -PassThru
    $invalidExit = $invalidProcess.ExitCode
    $invalidError = Get-Content -Raw $invalidStderr
    if ($invalidExit -ne 2 -or (Get-Item $invalidStdout).Length -ne 0 -or
        $invalidError -notmatch 'not a capturable user process') {
        throw "invalid PID did not return the expected validation error (exit $invalidExit): $invalidError"
    }
}
finally {
    Remove-Item -LiteralPath $invalidStdout, $invalidStderr -Force -ErrorAction SilentlyContinue
}

if ([Environment]::OSVersion.Version.Build -lt 20348) {
    $captureStdout = Join-Path $env:TEMP 'stream-audio-loopback-stdout.tmp'
    $captureStderr = Join-Path $env:TEMP 'stream-audio-loopback-stderr.tmp'
    try {
        $captureProcess = Start-Process -FilePath $exe -ArgumentList @(
            'capture', '--pid', [string]$PID, '--path', $currentProcessPath
        ) `
            -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $captureStdout `
            -RedirectStandardError $captureStderr -Wait -PassThru
        $captureExit = $captureProcess.ExitCode
        $captureError = Get-Content -Raw $captureStderr
        if ($captureExit -ne 3 -or (Get-Item $captureStdout).Length -ne 0 -or
            $captureError -notmatch 'requires Windows build 20348') {
            throw "unsupported Windows build was not rejected correctly (exit $captureExit): $captureError"
        }
    }
    finally {
        Remove-Item -LiteralPath $captureStdout, $captureStderr -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "Audio loopback CLI contract checks passed ($($entries.Count) interactive processes listed)."
