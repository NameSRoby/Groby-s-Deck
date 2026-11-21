param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = "$PSHOME\Modules"
function Test-WebViewRuntime {
  $taskRegistryKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($taskHive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
    foreach ($taskView in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
      $taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey($taskHive, $taskView)
      try {
        $taskKey = $taskBase.OpenSubKey($taskRegistryKey)
        if ($taskKey) {
          try { if ([version]($taskKey.GetValue('pv', '0.0.0.0')) -gt [version]'0.0.0.0') { return $true } }
          catch {} finally { $taskKey.Dispose() }
        }
      } finally { $taskBase.Dispose() }
    }
  }
  return $false
}
if (Test-WebViewRuntime) { Write-Host '[WEBVIEW2] Evergreen runtime is already installed.'; exit 0 }
if ($CheckOnly) { Write-Host '[WEBVIEW2] Evergreen runtime is missing.'; exit 2 }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskSpecPath = Join-Path $taskRoot 'desktop\windows-host\prerequisites.json'
if (!(Test-Path -LiteralPath $taskSpecPath)) { $taskSpecPath = Join-Path $PSScriptRoot 'prerequisites.json' }
try {
  $taskSpec = (Get-Content -LiteralPath $taskSpecPath -Raw | ConvertFrom-Json).webview2
  $taskInstaller = Join-Path $taskRoot ('optional-components\prerequisites\' + $taskSpec.file)
  if (!(Test-Path -LiteralPath $taskInstaller)) { throw 'The bundled WebView2 installer is missing. Extract the full release ZIP or run Setup.' }
  if ((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash -ine $taskSpec.sha256) { throw 'Bundled WebView2 installer checksum mismatch. Nothing was executed.' }
  $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskInstaller
  if ($taskSignature.Status -ne 'Valid' -or !$taskSignature.SignerCertificate -or $taskSignature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)') {
    throw 'Microsoft signature verification failed. Nothing was executed.'
  }
  $taskInstall = Start-Process -FilePath $taskInstaller -ArgumentList '/silent','/install' -Wait -PassThru -WindowStyle Hidden
  if (!(Test-WebViewRuntime)) { throw ('Runtime was not detected after installation (exit code ' + $taskInstall.ExitCode + ').') }
  Write-Host '[WEBVIEW2] Evergreen runtime is ready.'
  if ($taskInstall.ExitCode -in @(3010,1641)) { exit 3010 }
} catch {
  Write-Host ('[WEBVIEW2] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
