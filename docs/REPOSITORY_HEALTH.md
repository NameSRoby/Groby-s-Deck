# Repository health review - 0.8.1 - 2026-11-23

This bug-fix patch repairs settings restoration, Twitch supporter lists and overlay presentation.

## Release boundaries

Publication uses the explicit source inventory in scripts/build-publication.js. Windows artifacts stage production dependencies, verified prerequisites, trusted runtime binaries and authored optional-feature inventories. Installed feature directories, user runtime state, credentials, private media and build captures are excluded. Public OAuth client IDs remain available for account connection.

Song Request 0.45.24 and Twitch Integration 0.12.62 include the maintained fixes from the previously published packages. Core accepts the declared legacy/current storage capability names without changing storage ownership or quotas. Failed settings reads cannot silently overwrite recoverable state with defaults.

## Validation

The release gate includes maintained-source health, generated inventories, the full regression suite, an independently tested sanitized source snapshot, dependency audits, privacy scans, Windows artifact validation, isolated package startup and preservation checks. Hosted repository-health and CodeQL checks must pass on the release commit before publication. Final validation results are recorded with the release.

Browser regressions measure actual credits translation and wheel rotation through polling/redraws, including Windows reduced-motion emulation. They also verify full-canvas preview geometry, source-specific controls, rounded duration formats, spacing/separators, editable broadcast styles and matching OBS output. Synthetic provider tests cover all player selections, restart persistence and failed-restore file preservation.

Local account checks confirmed subscriber-credit loading and retained saved overlay data. Private account captures and logs stay outside publication.

## Practical limits

Automated fixtures and local account checks do not certify every physical light, audio driver, external provider or account restriction. Twitch charity donations refer to Twitch-hosted campaigns; external tip services need their own integration. Duration formatting uses 30-day months and 365-day years. Upgrading in the existing folder preserves private state; new automation presets remain inactive until reviewed and enabled.
