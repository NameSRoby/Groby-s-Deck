$ErrorActionPreference = 'Stop'
$repo = 'NameSRoby/Groby-s-Deck'
$assets = Join-Path $env:RUNNER_TEMP 'groby-downloads'
$root = Join-Path $env:RUNNER_TEMP ('Groby clean install ' + $env:QA_PATH)
New-Item -ItemType Directory -Path $assets | Out-Null

function Get-VerifiedDownload($version, $name, $directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    gh release download "v$version" --repo $repo --dir $directory --pattern SHA256SUMS.txt --pattern $name | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Could not download $name" }
    $record = @(Get-Content -LiteralPath (Join-Path $directory 'SHA256SUMS.txt') | Where-Object { ($_ -split '\s+', 2)[1] -eq $name })
    $archive = Join-Path $directory $name
    if ($record.Count -ne 1 -or (Get-FileHash -LiteralPath $archive).Hash -ne ($record[0] -split '\s+', 2)[0]) {
        throw "Checksum mismatch for $name"
    }
    return @{ Path = $archive; Hash = ($record[0] -split '\s+', 2)[0].ToLowerInvariant() }
}

$name = switch ($env:QA_PATH) {
    'installer' { 'Grobys-Deck-Windows-v0.8.2c-setup-installer.exe' }
    'upgrade' { 'Grobys-Deck-Windows-v0.8.2c-setup-installer.exe' }
    'portable' { 'Grobys-Deck-Windows-v0.8.2c-self-contained.zip' }
    'source' { 'Grobys-Deck-Windows-v0.8.2c.zip' }
    default { throw 'Unknown verification path' }
}
$asset = Get-VerifiedDownload '0.8.2c' $name $assets
$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if ($env:QA_PATH -eq 'upgrade') {
    $old = Get-VerifiedDownload '0.8.2b' 'Grobys-Deck-Windows-v0.8.2b.zip' (Join-Path $assets 'prior')
    New-Item -ItemType Directory -Path $root | Out-Null
    tar.exe -xf $old.Path -C $root
    if ($LASTEXITCODE -ne 0) { throw 'Previous ZIP extraction failed' }
    & (Join-Path $root 'runtime/Grobys-Deck-Node.exe') (Join-Path $root 'scripts/install-official-features.js') --offline song-request twitch-integration
    if ($LASTEXITCODE -ne 0) { throw 'Could not provision the previous versions for upgrade' }
    $priorManifest = Get-Content -Raw -LiteralPath (Join-Path $root 'features/installed/song-request/groby.feature.json') | ConvertFrom-Json
    if ($priorManifest.version -ne '0.45.30') { throw 'Previous package was not installed' }
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'runtime/system') | Out-Null
    Set-Content -LiteralPath (Join-Path $root 'runtime/system/qa-upgrade-marker.txt') -Value 'preserved'
}
$env:GH_TOKEN = ''
switch ($env:QA_PATH) {
    { $_ -in @('installer', 'upgrade') } {
        $log = Join-Path $env:RUNNER_TEMP 'groby-install.log'
        $setup = Start-Process -FilePath $asset.Path -ArgumentList ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $root + '" /LOG="' + $log + '"') -WindowStyle Hidden -PassThru -Wait
        if ($setup.ExitCode -ne 0) {
            Get-Content -LiteralPath $log -Tail 70
            throw "Installer exited with $($setup.ExitCode)"
        }
        if ($env:QA_PATH -eq 'upgrade' -and (Get-Content -LiteralPath (Join-Path $root 'runtime/system/qa-upgrade-marker.txt')) -ne 'preserved') {
            throw 'Upgrade lost local runtime data'
        }
    }
    'portable' {
        New-Item -ItemType Directory -Path $root | Out-Null
        tar.exe -xf $asset.Path -C $root
        if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP extraction failed' }
    }
    'source' {
        New-Item -ItemType Directory -Path $root | Out-Null
        $sourceArchive = Join-Path $assets 'source.zip'
        git -C qa-source archive --format=zip --output=$sourceArchive HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Source ZIP creation failed' }
        tar.exe -xf $sourceArchive -C $root
        if ($LASTEXITCODE -ne 0) { throw 'Source ZIP extraction failed' }
        $pin = Get-Content -LiteralPath (Join-Path $root 'scripts/source-runtime.json') -Raw | ConvertFrom-Json
        if ($pin.version -ne '0.8.2c' -or $pin.sha256 -ne $asset.Hash -or $pin.asset -ne $name) {
            throw 'Source contains a different runtime pin'
        }
        & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/setup-source.ps1') -NoStart -ReleaseArchive $asset.Path
        if ($LASTEXITCODE -ne 0) { throw 'Source setup failed' }
    }
}
$env:GROBY_QA_PLAYWRIGHT = Join-Path $pwd 'node_modules/playwright'
$runtime = Join-Path $root 'runtime/Grobys-Deck-Node.exe'
& $runtime .github/release-qa/clean-install.cjs $root --native-host --review-every-preset --every-surface
if ($LASTEXITCODE -ne 0) { throw 'App smoke check failed' }
if ($env:QA_PATH -eq 'source') {
    & $runtime .github/release-qa/online-packages.cjs $root
    if ($LASTEXITCODE -ne 0) { throw 'Online package installation failed' }
}
