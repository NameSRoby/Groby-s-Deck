# Desktop companion compatibility audit

Audit date: 2026-11-25. Trigger: another user's regular Spotify installation opened
as a black window after **Open Spotify with Groby’s Deck**. The affected Spotify
version and diagnostics were unavailable. The defects below are reproduced in
fixtures; the specific cause on that user's PC remains unconfirmed.

## Findings and corrections

| Area                         | Finding                                                                                                                                                | Correction and evidence                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify startup              | An existing `xpui-modules.js` could be patched without being loaded by the entry page. Relative snapshot URLs were also rejected.                      | Load the dependency before the snapshot entry for both existing and extracted modules. Fresh Chromium pages boot direct, existing-module and extracted-snapshot fixtures using the generated renderer.                                                                                                                        |
| Spotify patching             | A matching marker could produce invalid JavaScript; unused bundles could be treated as active hooks.                                                   | Compile the patched classic script without executing it. Only patch entry bundles and the snapshot's modules dependency. A destructuring fixture reproduces the unsafe old patch and now fails preparation.                                                                                                                   |
| Spotify launch button        | A saved installation ID was treated as proof of preparation. A process receipt cleared the opening state before pairing.                               | Verify inventory, source hashes, layout and pairing configuration before enabling launch. Cache verification using file metadata; any inventory/source change invalidates it. Verify again in the launcher. Deduplicate opening attempts and report a 45-second connection timeout. Older sidecars require preparation again. |
| Spotify discovery and launch | Discovery missed a local-app-data install; a Store launch resolved the executable again through PATH.                                                  | Discover local-app-data clients and process/Store locations. Launch the exact per-user Store alias without shell-source interpolation. Paths use each user's environment and installation discovery.                                                                                                                          |
| TIDAL actions                | Replacing a hoisted function with a `const` could cause a temporal-dead-zone exception.                                                                | Keep a hoisted wrapper and preserve original behavior if the optional hooks are absent. Tests call the action before its declaration with and without the runtime.                                                                                                                                                            |
| TIDAL assets                 | An optional transform error could reject a required asset. Only the default Electron session was covered.                                              | Transform a bounded clone; return the intact original response on failure or unsupported/unrelated source. Use the window's session for preloads, protocol handling and network fetches. Tests cover separate partitions, original headers and transform failures.                                                            |
| TIDAL startup and reconnect  | Reading a missing renderer could prevent the original app entry from starting. A retained old Core port was not repaired.                              | Disable optional hooks on setup failure and continue original startup. Repair a changed local port or missing old pairing path while maintaining the ownership journal. An existing binding to a different Core folder requires explicit Update.                                                                              |
| Windows Setup                | Music capture was selected by default on Windows 10, but its first-run check requires a newer Windows build. This could block setup of the entire app. | Gate the optional capture task at build 20348. Core's minimum remains Windows 10 build 19041; deselected capture follows the existing disabled-feature path.                                                                                                                                                                  |

TIDAL's updated payload is version 0.1.10 so Setup offers Update for older payloads.
Spotify's sidecar layout advances to version 4; old sidecars remain removable but
cannot be launched as verified companions.

## Portability and privacy review

Spotify entry discovery and insertion use `parse5` rather than HTML tag regular
expressions. Regression fixtures cover whitespace and attributes on end tags,
quoted angle brackets, entity-encoded URLs, comments and dormant template loaders.
This also corrects CodeQL alert 34 (`js/bad-tag-filter`) without suppressing it.

Additional regressions cover Unicode and shell punctuation through Windows
PowerShell, UTF-8 vault-map keys, read-only hardlinked source assets, and
catalog-bound pairing verification across Core restart. Files owned by Groby’s
Deck retain the exclusive-link requirement for modification or removal. Sidecar
preparation never modifies the installed client's source files.

Public song messages share a strict title/artist projection with no fallback to
queries, source labels, playlist names or provider account objects. Credential-like
metadata is withheld, and private-field canaries are checked across all four
providers. Verified Twitch request attribution is preserved separately.

Reviewed discovery, local configuration, patch preparation, generated renderer
payloads, native bridges, launchers, optional host wiring, first-run checks and
release/publication inventories. A literal-path scan across `src`, `integrations`,
`public`, `scripts`, `desktop`, `features` and `packages` found no maintainer user
profile or development-workspace literals in application sources. Locally generated
installation records intentionally contain the discovering user's paths; they
belong in ignored runtime storage.

Spotify-owned archives and snapshot code are read from the user's installation
and copied only to private runtime storage. TIDAL preserves and restores its own
original archive under an ownership journal. No private pairing tokens, account
tokens, machine runtime files or proprietary client assets are added to the
repository by these changes. Public OAuth client IDs remain included.

## Supported boundaries and remaining acceptance

- The distributed application targets x64-compatible Windows 10 build 19041 or
  later and Windows 11. Application audio capture additionally requires build
  20348 or later. This does not claim every Windows architecture or older build.
- The desktop viewer requires WebView2 114 or newer. Setup and the portable
  repair helper upgrade missing or older runtimes using the verified offline
  installer. Spotify connection streams use the older, widely supported reader
  interface rather than requiring asynchronous stream iteration in its browser.
- Spotify discovery covers regular and Microsoft Store clients. A Store launch
  requires its per-user execution alias. Native hooks and snapshot extraction
  depend on the installed client layout; unsupported shapes fail explicitly.
- TIDAL companion installation supports the regular desktop client. The Microsoft
  Store TIDAL package remains unsupported; WindowsApps resources are not patched.
  The active Electron runtime must expose the protocol, preload and fetch APIs.
  A missing API disables the optional hook and is recorded in local diagnostics.
- Automated startup checks use fresh browser contexts, synthetic archives and fake
  Electron sessions. They do not constitute another Windows PC, actual Spotify
  login, DRM playback, a real Store alias launch or every future client release.
- Before broad release acceptance, retest the affected PC with its exact Spotify
  version: prepare, launch, sign in, select the local playback device, enqueue,
  advance, remove a requested occurrence, restart Core and reopen the companion.
  Repeat the installation/launch checks on Windows 10 and Windows 11, with regular
  and Store Spotify and regular TIDAL. Ordinary playback must still work after a
  normal launch or companion removal.

Electron documents that [protocol handlers belong to a session](https://www.electronjs.org/docs/latest/api/protocol)
and that [session fetches use that session](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init).
Inno Setup documents [per-entry minimum Windows versions](https://jrsoftware.org/ishelp/topic_commonparams.htm).
These explain the API and packaging constraints; repository regression tests
provide the evidence for the corrections above.
