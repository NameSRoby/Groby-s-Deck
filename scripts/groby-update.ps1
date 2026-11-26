<#
Managed Windows update/rollback transaction. The managed path inventories below
are the boundary between replaceable application files and persistent user state.
Never broaden them to all files under Root: installed features, credentials, and
runtime data must survive. Stage/backup state is consumed by the host's expected-
version health check; an existing process is not proof of a successful upgrade.
Resolve and validate paths before moves/removals, and preserve recovery records
until the new host confirms health or restores the previous managed inventory.
#>
param(
  [ValidateSet("Apply", "Rollback")][string]$Action,
  [Parameter(Mandatory = $true)][string]$Root,
  [int]$HostPid = 0,
  [switch]$StopHost,
  [switch]$Background,
  [switch]$NoLaunch
)

# Node/host grandchildren of pwsh can inherit incompatible PowerShell 7 modules.
# This helper depends only on the standard modules belonging to its own PS host.
$env:PSModulePath = "$PSHOME\Modules"
$ErrorActionPreference = "Stop"
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
$updateRoot = Join-Path $rootPath "runtime\updates"
$stagedStatePath = Join-Path $updateRoot "staged.json"
$pendingPath = Join-Path $updateRoot "pending-health.json"
$availablePath = Join-Path $updateRoot "available-rollback.json"
$logPath = Join-Path $updateRoot "update.log"
$operationPath = Join-Path $updateRoot "operation.json"
$managedDirectories = @("src", "public", "assets", "packages", "integrations", "node_modules", "scripts", "feature-packages", "optional-components")
$managedFiles = @("package.json", "package-lock.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "RELEASE_BUILD.json", "Groby's Deck.exe")
$managedRuntimeFiles = @("Grobys-Deck-Node.exe", "NODE-LICENSE.txt", "music-to-light\cargo\release\groby-audio-probe.exe", "desktop\Microsoft.Web.WebView2.Core.dll", "desktop\Microsoft.Web.WebView2.WinForms.dll", "desktop\WebView2Loader.dll", "desktop\LICENSE.WebView2.txt")

function Write-UpdateLog([string]$Value) {
  New-Item -ItemType Directory -Force -Path $updateRoot | Out-Null
  Add-Content -LiteralPath $logPath -Value "$([DateTimeOffset]::Now.ToString('o')) $Value" -Encoding UTF8
}

function Read-Json([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing update state: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-JsonAtomic([string]$Path, $Value) {
  $temporary = "$Path.$PID.tmp"
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-ChildPath([string]$Candidate, [string]$Parent) {
  $resolvedCandidate = [IO.Path]::GetFullPath($Candidate)
  $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (!$resolvedCandidate.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe update path: $resolvedCandidate" }
  return $resolvedCandidate
}

function Set-UpdatePhase([string]$Phase) {
  if (!(Test-Path -LiteralPath $operationPath -PathType Leaf)) { return }
  $operation = Read-Json $operationPath
  $operation.phase = $Phase
  Write-JsonAtomic $operationPath $operation
}

function Wait-ForHost {
  if ($HostPid -le 0 -or $HostPid -eq $PID) { return }
  try {
    $hostProcess = Get-Process -Id $HostPid -ErrorAction Stop
    if ($StopHost) {
      Set-UpdatePhase "restarting"
      $executable = Join-Path $rootPath "Groby's Deck.exe"
      $stopProcess = Start-Process -FilePath $executable -ArgumentList "--stop" -WorkingDirectory $rootPath -WindowStyle Hidden -PassThru
      try {
        if (!$stopProcess.WaitForExit(10000)) { throw "Windows stop command did not finish in time" }
      } finally {
        $stopProcess.Dispose()
      }
    }
    if (!$hostProcess.WaitForExit(30000)) { throw "Windows host did not stop in time" }
  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { }
}

function Copy-TreeItem([string]$Source, [string]$Destination) {
  if (!(Test-Path -LiteralPath $Source)) { return }
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Remove-Managed([string]$Base) {
  foreach ($relative in $managedDirectories + $managedFiles) {
    $target = Assert-ChildPath (Join-Path $Base $relative) $Base
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
  foreach ($relative in $managedRuntimeFiles) {
    $target = Join-Path $Base "runtime\$relative"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  }
}

function Copy-Managed([string]$Source, [string]$Destination) {
  foreach ($relative in $managedDirectories + $managedFiles) {
    Copy-TreeItem (Join-Path $Source $relative) (Join-Path $Destination $relative)
  }
  foreach ($relative in $managedRuntimeFiles) {
    Copy-TreeItem (Join-Path $Source "runtime\$relative") (Join-Path $Destination "runtime\$relative")
  }
}

function Start-Core([string]$Argument) {
  if ($NoLaunch) { return }
  $executable = Join-Path $rootPath "Groby's Deck.exe"
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Updated Windows host is missing" }
  $arguments = @($Argument)
  if ($Background) { $arguments += "--background" }
  Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $rootPath -WindowStyle Hidden
}

function Restore-Backup($State) {
  $backupPath = Assert-ChildPath "$($State.backupPath)" (Join-Path $updateRoot "rollback")
  if (!(Test-Path -LiteralPath $backupPath -PathType Container)) { throw "Rollback snapshot is missing" }
  Remove-Managed $rootPath
  Copy-Managed $backupPath $rootPath
}

$extractPath = $null
$backupPath = $null
$hostStopped = $false
try {
  Write-UpdateLog "$Action started"
  if ($Action -eq "Rollback") {
    $automatic = Test-Path -LiteralPath $pendingPath -PathType Leaf
    $statePath = if ($automatic) { $pendingPath } else { $availablePath }
    $state = Read-Json $statePath
    $backupPath = Assert-ChildPath "$($state.backupPath)" (Join-Path $updateRoot "rollback")
    if (!(Test-Path -LiteralPath (Join-Path $backupPath "Groby's Deck.exe") -PathType Leaf)) {
      throw "Rollback snapshot is incomplete"
    }
    Wait-ForHost
    $hostStopped = $true
    Restore-Backup $state
    Remove-Item -LiteralPath $statePath -Force
    Write-UpdateLog "Restored version $($state.previousVersion)"
    Set-UpdatePhase $(if ($automatic) { "rolled-back" } else { "restored" })
    Start-Core "--post-rollback"
    Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }

  if (Test-Path -LiteralPath $pendingPath) { throw "An earlier update still needs health confirmation" }
  $staged = Read-Json $stagedStatePath
  if ($staged.verified -ne $true -or "$($staged.version)" -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?[a-z]?$') { throw "Update is not verified" }
  $archivePath = Assert-ChildPath "$($staged.archivePath)" (Join-Path $updateRoot "downloads")
  if (!(Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "Staged archive is missing" }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($actualHash -ne "$($staged.sha256)".ToLowerInvariant()) {
    Remove-Item -LiteralPath $stagedStatePath -Force
    throw "Staged archive checksum changed"
  }

  $extractPath = Assert-ChildPath (Join-Path $updateRoot "extract-$($staged.version)-$PID") $updateRoot
  $rollbackRoot = Join-Path $updateRoot "rollback"
  $backupPath = Assert-ChildPath (Join-Path $rollbackRoot "$([DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'))-$PID") $rollbackRoot
  New-Item -ItemType Directory -Force -Path $extractPath, $backupPath | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
  $release = Read-Json (Join-Path $extractPath "RELEASE_BUILD.json")
  if ("$($release.version)" -ne "$($staged.version)" -or "$($release.channel)" -ne "release") { throw "Archive release identity does not match" }
  foreach ($entry in @("src\app\optional\feature-enabled-server.js", "Groby's Deck.exe", "runtime\Grobys-Deck-Node.exe")) {
    if (!(Test-Path -LiteralPath (Join-Path $extractPath $entry) -PathType Leaf)) { throw "Archive is missing $entry" }
  }
  $releasePath = Join-Path $rootPath "RELEASE_BUILD.json"
  $current = if (Test-Path -LiteralPath $releasePath) { Read-Json $releasePath } else { Read-Json (Join-Path $rootPath "package.json") }
  $previousVersion = if ($current.releaseVersion) { $current.releaseVersion } else { $current.version }
  # Check write access before stopping the app.
  $probePath = Join-Path $rootPath ".update-write-$PID.tmp"
  New-Item -ItemType File -Path $probePath | Out-Null
  Remove-Item -LiteralPath $probePath -Force

  Copy-Managed $rootPath $backupPath
  $rollback = [ordered]@{
    previousVersion = "$previousVersion"
    updatedVersion = "$($staged.version)"
    backupPath = $backupPath
    createdAt = [DateTimeOffset]::UtcNow.ToString("o")
  }
  Wait-ForHost
  $hostStopped = $true
  Write-JsonAtomic $pendingPath $rollback
  Remove-Managed $rootPath
  Copy-Managed $extractPath $rootPath
  Write-UpdateLog "Applied version $($staged.version); awaiting health confirmation"
  Start-Core "--post-update"
} catch {
  Write-UpdateLog "$Action failed: $($_.Exception.Message)"
  Set-UpdatePhase "failed"
  if ($Action -eq "Apply" -and $hostStopped) {
    try {
      if (Test-Path -LiteralPath $pendingPath) {
        Restore-Backup (Read-Json $pendingPath)
        Remove-Item -LiteralPath $pendingPath -Force
        Set-UpdatePhase "rolled-back"
      }
      Start-Core "--post-rollback"
    } catch {
      Write-UpdateLog "Immediate recovery failed: $($_.Exception.Message)"
    }
  }
  throw
} finally {
  if ($extractPath) {
    Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Action -eq "Apply" -and $backupPath -and !(Test-Path -LiteralPath $pendingPath)) {
    # A fast successful restart may already have promoted this snapshot.
    $available = if (Test-Path -LiteralPath $availablePath) { Read-Json $availablePath } else { $null }
    if (!$available -or $available.backupPath -ne $backupPath) {
      Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
