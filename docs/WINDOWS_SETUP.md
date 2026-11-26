# Windows setup

Groby’s Deck 0.8 includes the application, Node runtime, production dependencies, audio helper and optional first-party packages. Users do not need developer tools.

| Component                        | Installation                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebView2 browser runtime         | Reuse Evergreen version 114 or newer. If missing or older, Setup verifies and runs the bundled Microsoft Evergreen Standalone Installer. No network download is needed. |
| WebView2 SDK bindings and loader | Included under `runtime/desktop`; these small files are required to host the shared browser runtime.                                                                    |
| Music-to-Light                   | Optional statically linked capture helper. App capture requires Windows build 20348 or later.                                                                           |
| Twitch and Song Request          | Verified packages selected by default in Setup and installed on first portable launch. Account connections are completed afterwards.                                      |
| Spotify/TIDAL companions         | Included first-party integrations; require the separately installed player.                                                                                             |
| .NET Framework                   | 4.8 or newer, included on supported Windows; repair through Windows Update if missing.                                                                                  |

Windows 10 x64 build 19041 or later is required. App audio capture requires build 20348 or later; Setup offers it only on supported systems.

## Install or upgrade

Run **Grobys-Deck-Windows-v0.8.2c-setup-installer.exe**. When upgrading Core, use the existing application folder to retain your settings. Setup stops the old host before replacing application files and preserves `runtime`, accounts, mods and installed feature settings.

For portable use, extract **Grobys-Deck-Windows-v0.8.2c-self-contained.zip** completely and run **Groby's Deck.exe**. If WebView2 is missing or outdated, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-webview2.ps1`. The helper skips supported installations and repairs older ones. The desktop viewer also checks this minimum after an app update and offers browser recovery when it is not met.

Setup and portable archives include Microsoft’s full Evergreen Standalone Installer. No internet is needed to install WebView2. The portable helper verifies its checksum and Microsoft signature; Setup verifies its pinned checksum. A failed install blocks an incomplete first launch.

## Source ZIP

Run **Start-Grobys-Deck.cmd**. Source setup verifies and downloads the matching release runtime, builds the desktop host, checks WebView2, and launches the app. Tests are optional and use synthetic fixtures. No private development runtime or sign-in data is part of the source ZIP.

## Runtime updates

Evergreen updates through Microsoft. Forward compatibility is a testing goal rather than a guarantee for every future browser change. Test supported web-platform features with current Stable and preview runtimes when changing the desktop UI.

[Microsoft WebView2 distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)
