param(
  [switch]$NoStart,
  [string]$ReleaseArchive = ""
)

$ErrorActionPreference = "Stop"
# PowerShell 7 parents can pass incompatible module directories to Windows PowerShell.
# Setup uses only built-in modules; keep discovery local to this PowerShell process.
$env:PSModulePath = "$PSHOME\Modules"
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stage = $null
try {
  if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw "Use a Windows 10 or 11 x64 PC. Native ARM64 is not currently supported."
  }
  $spec = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-runtime.json') -Raw | ConvertFrom-Json
  if ($spec.version -notmatch '^\d+\.\d+(?:\.\d+)?[a-z]?$' -or
      $spec.asset -cnotin @("Grobys-Deck-Windows-v$($spec.version).zip", "Grobys-Deck-Windows-v$($spec.version)-fresh-pc.zip") -or
      $spec.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid source runtime manifest.' }
  $cache = Join-Path $root 'runtime\source-setup'
  $stamp = Join-Path $cache 'ready.json'
  $node = Join-Path $root 'runtime\Grobys-Deck-Node.exe'
  $lockHash = (Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
  $ready = $false
  if (!$ReleaseArchive -and (Test-Path -LiteralPath $stamp) -and (Test-Path -LiteralPath $node -PathType Leaf)) {
    try {
      $state = Get-Content -LiteralPath $stamp -Raw | ConvertFrom-Json
      if ($state.lock -eq $lockHash -and $state.archive -eq $spec.sha256) {
        & $node (Join-Path $PSScriptRoot 'verify-source-runtime.js') $root $root
        $ready = $LASTEXITCODE -eq 0
      }
    } catch {
      Write-Host '[SETUP] Cached runtime could not be verified. Restoring the pinned bundle.'
    }
  }
  if (!$ready) {
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $archive = Join-Path $cache $spec.asset
    if ($ReleaseArchive) {
      $archive = (Resolve-Path -LiteralPath $ReleaseArchive).Path
    } elseif (!(Test-Path -LiteralPath $archive -PathType Leaf) -or
              (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $spec.sha256) {
      Write-Host '[SETUP] Downloading the official Windows runtime and offline prerequisites...'
      $downloadUrl = "https://github.com/NameSRoby/Groby-s-Deck/releases/download/v$($spec.version)/$($spec.asset)"
      $download = "$archive.part"
      $previousProgress = $ProgressPreference
      try {
        $ProgressPreference = 'SilentlyContinue'
        $curl = Join-Path $env:WINDIR 'System32\curl.exe'
        if (Test-Path -LiteralPath $curl -PathType Leaf) {
          & $curl --fail --location --silent --show-error --connect-timeout 15 --max-time 300 --retry 2 --output $download $downloadUrl
          if ($LASTEXITCODE -ne 0) {
            throw "Runtime download failed (curl exit code $LASTEXITCODE). Retry or use -ReleaseArchive with the pinned Windows ZIP."
          }
        } else {
          [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
          Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $download -TimeoutSec 300
        }
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ine $spec.sha256) {
          throw 'Downloaded runtime checksum mismatch. No downloaded code was run.'
        }
        Move-Item -LiteralPath $download -Destination $archive -Force
      } finally {
        $ProgressPreference = $previousProgress
        if (Test-Path -LiteralPath $download -PathType Leaf) { Remove-Item -LiteralPath $download -Force }
      }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $spec.sha256) {
      throw "Runtime checksum mismatch. No downloaded code was run. Remove the cached archive in runtime/source-setup and try again."
    }
    Write-Host '[SETUP] Verified archive. Preparing runtime and audio capture...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # Keep extraction shallow: Windows PowerShell's ZIP APIs have a path limit.
    $stageRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $stage = Join-Path $stageRoot ("ravelink-source-" + [Guid]::NewGuid().ToString('N').Substring(0, 16))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
      foreach ($entry in $zip.Entries) {
        # Windows Compress-Archive and tar use different ZIP path separators.
        # Normalize both before filtering and checking the extraction boundary.
        $relative = ($entry.FullName -replace '\\', '/') -replace '^\./', ''
        if ($relative -notmatch '^(node_modules/|optional-components/prerequisites/|runtime/Grobys-Deck-Node\.exe$|runtime/music-to-light/cargo/release/groby-audio-probe\.exe$|runtime/NODE-LICENSE\.txt$|runtime/desktop/(Microsoft\.Web\.WebView2\.(Core|WinForms)\.dll|WebView2Loader\.dll|LICENSE\.WebView2\.txt)$|package-lock\.json$)') { continue }
        $destination = [IO.Path]::GetFullPath((Join-Path $stage $relative))
        if (!$destination.StartsWith("$stage\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
        if ($relative.EndsWith('/')) { continue }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
      }
    } finally { $zip.Dispose() }
    $stagedNode = Join-Path $stage 'runtime\Grobys-Deck-Node.exe'
    # A runtime from another dependency graph must never silently satisfy this source tree.
    & $stagedNode (Join-Path $PSScriptRoot 'verify-source-runtime.js') $root $stage
    if ($LASTEXITCODE -ne 0) { throw 'The pinned runtime does not match this source lockfile. See README for developer setup.' }
    # Node handles long destination paths even when Windows PowerShell cannot.
    $copyScript = "const fs=require('node:fs'),path=require('node:path');for(const dir of ['node_modules','runtime','optional-components'])fs.cpSync(path.join(process.argv[1],dir),path.join(process.argv[2],dir),{recursive:true,force:true});"
    & $stagedNode -e $copyScript $stage $root
    if ($LASTEXITCODE -ne 0) { throw 'Runtime installation failed. See the setup output above.' }
    @{ lock = $lockHash; archive = $spec.sha256 } | ConvertTo-Json | Set-Content -LiteralPath $stamp -Encoding UTF8
  }
  $hostStamp = Join-Path $cache 'host.sha256'
  $hostHash = (@('desktop\windows-host\GrobyDeckHost.cs', 'desktop\windows-host\DashboardWindow.cs', 'desktop\windows-host\DesktopBrowserActions.cs', 'desktop\windows-host\DesktopPolicy.cs', 'desktop\windows-host\webview2-sdk.json', 'desktop\windows-host\app.manifest', 'assets\Grobys-Deck.ico', 'scripts\build-windows-host.ps1', 'scripts\restore-webview2.ps1') | ForEach-Object {
    (Get-FileHash -LiteralPath (Join-Path $root $_) -Algorithm SHA256).Hash
  }) -join ':'
  if (!(Test-Path -LiteralPath (Join-Path $root 'Groby''s Deck.exe')) -or
      !(Test-Path -LiteralPath $hostStamp) -or (Get-Content -LiteralPath $hostStamp -Raw).Trim() -ne $hostHash) {
    & (Join-Path $PSScriptRoot 'build-windows-host.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Windows launcher build failed. Exit Core before rebuilding changed launcher sources.' }
    Set-Content -LiteralPath $hostStamp -Value $hostHash -Encoding ASCII
  }
  Write-Host '[SETUP] Ready. The app installs Twitch Integration and Song Request from the bundled files on first launch.'
  & (Join-Path $PSScriptRoot 'install-webview2.ps1')
  if ($LASTEXITCODE -notin @(0,3010)) { throw 'WebView2 setup failed.' }
  if (!$NoStart) { Start-Process -FilePath (Join-Path $root 'Groby''s Deck.exe') -WorkingDirectory $root -WindowStyle Hidden }
} catch {
  Write-Host "[SETUP] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($stage -and [IO.Path]::GetFullPath($stage).StartsWith("$stageRoot\ravelink-source-", [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
