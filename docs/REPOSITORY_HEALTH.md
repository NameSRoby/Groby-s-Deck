# Security review - 0.8.1b - 2026-11-24

This vulnerability patch reviews the 12 open CodeQL alerts against the published 0.8.1a source. Six findings concern production overlay media handling; six concern test fixtures. The security boundary remains the local/same-host operator and same-origin admission middleware.

## Production remediation

| Alerts     | Review and change                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19, 21, 33 | Require string MIME types and filenames before lookup, matching or string operations. Use an explicit MIME map so inherited object keys are never accepted. Preserve content-signature and size validation.                                                                                                                |
| 26, 27     | Require complete server-generated UUID filenames, resolve paths within the canonical media root, reject linked files and redirected directories, and use rooted Express file delivery. Ordinary string traversal was already constrained by the filename allowlist; the patch adds explicit filesystem containment checks. |
| 23         | Apply a dedicated media-read limiter after operator admission. A shared 1,200-request/minute budget covers GET, HEAD and video/audio Range requests while protecting filesystem work.                                                                                                                                      |

The implementation follows CodeQL's recommendations for [runtime input types](https://codeql.github.com/codeql-query-help/javascript/js-type-confusion-through-parameter-tampering/), [canonical file containment](https://codeql.github.com/codeql-query-help/javascript/js-path-injection/) and [request throttling](https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/). Scanner severity is not evidence that arbitrary remote file access or code execution was possible in the original guarded route.

## Reviewed test findings

| Alerts | Resolution and evidence                                                                                                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 28-31  | False positives. The injected `fetchCatalog` mock in `test/stream-overlays.browser.test.js` selects synthetic emote responses. It performs no network request, URL authorization, redirection or trust decision. The substring checks are not production hostname sanitizers. |
| 24     | Used in tests. The clipboard fixture in `test/command-list.test.js` binds an ephemeral server to loopback, reads a single constant repository file and closes it during cleanup. The application never registers this route.                                                  |
| 22     | False positive. The clipboard fixture uses `req.query.wrong` only as a boolean selecting one of two literal page IDs. No raw query value enters generated JavaScript; the remaining values and relay source are constants.                                                    |

Each dismissal records its own reasoning in GitHub. Test and production scanning remain enabled; no query or directory is excluded to hide these findings.

## Verification and release gates

Regressions exercise arrays, objects, inherited MIME keys, encoded traversal, newline/NUL suffixes, missing assets, directory junctions, linked files where supported, upload quotas, fixed content types, Range responses, origin checks and read throttling. Existing editor/OBS browser checks cover actual media upload and playback behavior.

A successful CodeQL workflow means analysis completed; alert state must be checked separately. Publication requires source health, generated inventories, the regression suite, dependency auditing, CodeQL analysis on the release tree, verification of the remaining default-branch alerts, artifact integrity and privacy scans. Final results are recorded in release notes.

## Publication boundaries

The explicit source inventory and verified authored feature caches exclude installed packages, private runtime state, credentials, logs, captures and personal media. Required public OAuth client IDs remain included. Song Request 0.45.25 and Twitch Integration 0.12.62 are unchanged from 0.8.1a; this patch changes Core media handling. Upgrading in the existing folder preserves local settings and sign-ins.
