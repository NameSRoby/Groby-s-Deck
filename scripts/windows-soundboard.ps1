# Structured local soundboard bridge. EOF closes playback when Core exits.
param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$vendor = Join-Path (Split-Path -Parent $PSScriptRoot) 'integrations\soundboard\vendor'
$libraries = Get-Content -LiteralPath (Join-Path (Split-Path $vendor) 'libraries.json') -Raw | ConvertFrom-Json
$references = @((Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\netstandard.dll'))
foreach ($library in $libraries) {
  $file = Join-Path $vendor $library.file
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $library.sha256) { throw 'soundboard_library_invalid' }
  [void][Reflection.Assembly]::LoadFrom($file)
  $references += $file
}
Add-Type -Path (Join-Path $PSScriptRoot 'windows-soundboard.cs') -ReferencedAssemblies ($references + @('System.dll', 'System.Core.dll'))
function Write-Result($Value) { [Console]::WriteLine(($Value | ConvertTo-Json -Depth 8 -Compress)) }
if ($SelfTest) { Write-Result ([Groby.Soundboard.Player]::Status()); exit 0 }
Write-Result @{ready=$true}
try {
  while ($null -ne ($line=[Console]::ReadLine())) {
    $message=$null
    try {
      if ($line.Length -gt 16384) { throw 'soundboard_request_invalid' }
      $message=$line | ConvertFrom-Json
      if ("$($message.id)" -notmatch '^\d{1,12}$') { throw 'soundboard_request_invalid' }
      $p=$message.payload
      if ($message.operation -eq 'soundboard.status') { $value=[Groby.Soundboard.Player]::Status() }
      elseif ($message.operation -eq 'soundboard.stop') { $value=[Groby.Soundboard.Player]::Stop([string]$p.clip) }
      elseif ($message.operation -eq 'soundboard.play') {
        if ($p.clip -notmatch '^[a-f0-9]{64}\.(wav|mp3)$' -or @($p.outputs).Count -lt 1 -or @($p.outputs).Count -gt 8 -or @($p.outputs | Where-Object { $_ -notmatch '^(default|device:[a-f0-9]{64})$' }).Count -gt 0 -or $p.volume -isnot [int] -or $p.volume -lt 0 -or $p.volume -gt 100 -or $p.mode -notin @('restart','overlap','toggle')) { throw 'soundboard_request_invalid' }
        $value=[Groby.Soundboard.Player]::Play($p.clip,$p.file,[string[]]@($p.outputs),$p.volume,$p.mode)
      } else { throw 'soundboard_request_invalid' }
      Write-Result @{id="$($message.id)";ok=$true;value=$value}
    } catch {
      $taskError=$_.Exception
      while ($taskError.InnerException) { $taskError=$taskError.InnerException }
      $code=$taskError.Message
      if ($code -notmatch '^soundboard_[a-z_]{1,60}$') { $code='soundboard_playback_failed' }
      Write-Result @{id="$($message.id)";ok=$false;code=$code}
    }
  }
} finally { [void][Groby.Soundboard.Player]::Stop('') }
