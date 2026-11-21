# Repository health review - 0.7.6b - 2026-11-09

This is a focused maintenance release for optional Song Request and Twitch workers.

## Changes

- Song Request 0.45.12 allows 256 MiB active RSS; Twitch Integration 0.12.10
  allows 192 MiB. These budgets cover the complete Node process. Sustained
  resource enforcement remains enabled. Third-party mod limits are unchanged.
- A valid request that expires in transit returns a retryable timeout instead of
  disconnecting the worker. Malformed requests still fail closed, and protocol
  failures retain their nonzero exit code.
- An app-wide alert identifies unexpected worker exits, startup failures and
  resource stops, with a Packages recovery link. It clears after recovery and
  also shows saved resource stops when the dashboard is first opened.

## Validation and publication

Focused worker, package and browser regressions passed, including expired-request
recovery for feature and mod workers, malformed-request rejection, memory policy
bounds, crash recovery and warnings after reopening the dashboard.

The release process separately checks maintained source, a clean sanitized source
snapshot, dependency audits, generated inventories, resource budgets, archive and
installer payload consistency, isolated startup and updater preservation. Hosted
repository health and all three CodeQL jobs must pass on the exact release commit
before publication.

Source uses an explicit publication inventory. Runtime data, account grants,
credentials, local machine bindings, personal media, logs and build caches are
excluded. Exact private-value comparisons and executable build-path scans passed.
Secret-scanner findings were reviewed: the OAuth application identifier is public
configuration, and the keyboard-binding strings are synthetic test values.

## Practical limits

Automated tests do not certify every external account, physical light or audio
driver. Increased memory headroom prevents premature resource stops; it does not
promise that every future crash or unbounded allocation is impossible. Windows
setup retains the offline prerequisites shipped in 0.7.6a. Existing local settings
and account sign-ins remain private and are preserved during upgrades.

## Local follow-up - 2026-11-13

These changes are local and have not been published as another release.

- Chat song requests and Channel Points share configured moderation and role
  limits, including pending managed requests already handed to native players.
  Admission pauses delivery while counting receipts, deduplicates entry IDs and
  rejects intake when native counts cannot be verified.
- Deck faders have large tap/hold precision buttons and optional space filling.
  Fullscreen touch haptics are opt-in, with a visible Edit toggle and sensitivity
  setting. Unsupported browsers keep ordinary controls available.
- Layout work batches geometry reads and writes, caches unchanged rendering and
  keeps audio writes serialized while showing immediate local adjustment.
- Local resource allowances include six-second default feature startup, 0.25%
  idle CPU for Song Request/Twitch, and 128 MiB active RSS for the clip worker.

Validation: all 1,086 full-suite tests passed. Ten focused deck browser checks
also passed after the last touch-feedback adjustment. Formatting, lint, import
resolution, source structure, generated integrity and clean-slate checks passed.
Phone/tablet previews used synthetic channels; vibration was mocked. Physical
touch assistive technology, vibration hardware and live account behavior remain
separate acceptance checks. Private captures and logs stay under runtime.

See [touch-fader research](research/touch-deck-faders-2026-11-13.md) for sources
and browser limitations.

## Deck redesign and sequence follow-up - 2026-11-13

This work remains local; no additional release has been published.

- Faders use a slim rail and centered thumb inside a broad touch area. The bulky
  surround is removed, precision controls share a row, and desktop dock alignment
  is checked against the real button grid at two desktop widths.
- Optional Smoke, Aurora and Embers backgrounds have speed/strength settings,
  bulk styling, pause, reduced-motion support and offscreen/hidden suspension.
- Ordered action/wait blocks support timed finishes, delayed starts, duplication,
  reordering, repetitions and press-again-to-stop. Core owns the timers; shutdown
  cancels them. Ordinary action permissions and failure handling still apply.

The full suite passed all 1,093 cases. After the final slider adjustments, all 23
selected regressions passed, covering touch surfaces, exact entry, holds, desktop
centering, mixer layouts, sequence editing/execution and native volume routing.
Source health and generated-integrity checks passed. Captures use synthetic owners
and remain private. Live playback changes are not part of the regression suite.

See [design and scheduling notes](research/deck-redesign-and-sequences-2026-11-13.md).
