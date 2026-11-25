# Repository health and security review

## 0.8.2 - 2026-11-25

Fresh-runtime browser checks cover both verified first-party packages with no
account or personal settings, static public catalogs, editable drafts and
cross-workspace setup links. The optional setup overview starts collapsed.
Separate policy regressions cover missing rewards, explicitly selected chat,
two-way mode switching, persistent pause admission and closed-queue holds.

A reproduced slow-storage startup failure exceeded both a one-second storage
read and the previous six-second worker startup deadline. Bounded storage and
activation deadlines now allow ordinary cold Windows startup, and failed
activation retains its original classified diagnosis. Real worker restart
checks preserve player choice, queue configuration and overlay profiles.
Unreadable settings remain recoverable without being overwritten.

Public catalogs contain no account, credential, local device or OBS binding.
The public test inventory remains reduced to 67 end-user regression files;
development-only tests and private runtime data stay out of publications.
The release keeps the required public OAuth client IDs. Design sources and
the precise request-mode rules are documented in [Setup and public presets](SETUP_AND_PRESETS.md).

The affected remote PC's exact error was unavailable. The reproduced startup
defect is fixed; its relationship to that particular report remains unconfirmed.

The local end-user suite completed 410 cases: 409 passed and one Windows
file-symlink privilege check skipped. The latest affected automation, mode,
catalog and browser checks passed all 50 cases. Source structure, lint, generated
payload verification and the dependency audit passed. Published source and
download contents are separately checked for private values and machine paths.

## 0.8.1c - 2026-11-25

The [compatibility audit](COMPANION_COMPATIBILITY.md) records companion startup,
launch admission, pairing persistence, hardlink ownership, Unicode transport,
TIDAL session/fallback and Windows setup regressions. Public song formatting
projects title and artist while retaining verified Twitch requester credit.
Private playlist, account, credential and query canaries exercise automatic
announcements and information replies across all four providers.

Theme coverage exercises all nine presets across Core and sandboxed pages,
standalone tools, semantic hover colors and cross-frame light dismissal in
Chromium and Firefox. Cancel handlers protect unsaved work; light dismissal
never submits a destructive confirmation.

`test/public-suite.json` names 64 end-user regression files, replacing the former
240 published test files. The complete development suite remains in the local
workspace. Hosted regression checks run the published inventory. CodeQL excludes
test fixtures and the two generated companion copies while retaining authored
application code, including `features/*/dist`. C# and workflow analysis remain
enabled. This does not suppress production findings.

The earlier screenshot's canceled C# job left its PR without a SARIF category;
the subsequent default-branch CodeQL and health runs succeeded. Final 0.8.1c
results and alert states require their own verification.

## 0.8.1b security review - 2026-11-24

This patch reviews the 12 open CodeQL alerts against the published 0.8.1a source. Three production findings are addressed with file containment and throttling. Three production binary-body warnings and six fixture findings are documented false positives or test-only concerns. Local/same-host operator and same-origin admission remain required.

## Production remediation

| Alerts | Review and change                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 26, 27 | Require complete generated UUID filenames, resolve files within the canonical media root, reject linked files and redirected directories, and use rooted Express file delivery. Ordinary string traversal was already constrained by the filename allowlist; the patch adds explicit filesystem containment. |
| 23     | Apply a dedicated read limiter after operator admission. The shared 1,200-request/minute budget covers GET, HEAD and audio/video Range requests.                                                                                                                                                             |

Additional hardening requires scalar MIME types and filenames and uses a MIME map to exclude inherited object keys. Signature checks and upload quotas are preserved. These changes follow CodeQL guidance for [input types](https://codeql.github.com/codeql-query-help/javascript/js-type-confusion-through-parameter-tampering/), [canonical file containment](https://codeql.github.com/codeql-query-help/javascript/js-path-injection/) and [throttling](https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/). Scanner severity alone does not establish an exploitable remote file-read or code-execution vulnerability.

## False positives and test findings

| Alerts     | Resolution and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 19, 21, 33 | False positives in production. SARIF traces the two raw-upload routes to three `body.length` accesses. The existing `!Buffer.isBuffer(body)` check short-circuits before the first access and throws before subsequent accesses for every non-Buffer body. Regression cases reject strings, arrays, objects, misleading length fields and typed arrays before filesystem access. The [Node API](https://nodejs.org/api/buffer.html#static-method-bufferisbufferobj) distinguishes Buffers from those types; the scanner has not modeled that narrowing here. |
| 28-31      | False positives. The injected `fetchCatalog` browser-test mock selects synthetic emote responses. It does not fetch URLs, authorize them, redirect or grant trust. The substring checks are not production hostname sanitizers.                                                                                                                                                                                                                                                                                                                              |
| 24         | Used in tests. The ephemeral clipboard fixture binds to loopback, reads one fixed repository file and closes during cleanup. The application never registers that test route.                                                                                                                                                                                                                                                                                                                                                                                |
| 22         | False positive. The clipboard fixture uses `req.query.wrong` only as a boolean selecting one of two literal page IDs. Raw query values never enter generated JavaScript; other values and the required relay source are constants.                                                                                                                                                                                                                                                                                                                           |

Each dismissal records its own evidence in GitHub. Production and test scanning remain enabled; no query or directory is excluded to hide findings.

## Validation and release gates

Regressions cover malformed MIME and binary bodies, inherited keys, encoded traversal, newline/NUL suffixes, missing files, directory junctions, file symlinks where supported, quotas, fixed MIME types, Range responses, origin admission and read throttling. Existing editor/OBS browser checks exercise actual media use.

A successful CodeQL workflow means analysis completed. Incremental PR results also do not establish that existing default-branch alerts closed. Publication requires review of actual default-branch alert states, source health, generated inventories, regressions, dependency audits, artifact comparisons and privacy scans. Final results are recorded in release notes.

## Publication boundaries

The explicit source inventory and verified authored feature caches exclude installed packages, private runtime state, credentials, logs, captures and personal media. Required public OAuth client IDs remain included. Song Request 0.45.25 and Twitch Integration 0.12.62 are unchanged from 0.8.1a. Upgrading in the existing folder preserves local settings and sign-ins.
