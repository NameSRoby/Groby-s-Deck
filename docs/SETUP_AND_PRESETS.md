# Setup and public presets

All workspaces remain available in any order. A compact Setup bar stays above the workspaces until setup is complete or dismissed. It tracks saved pairings, connections, player choices, button availability and saved overlays. Expand Steps to skip individual features; skipping setup does not disable or remove their controls. Dismissals persist on this Core installation. Use Theme settings → Review setup to return to the guide. Completed setup stays complete across restarts.

## First use

- **Song Request → Player → Setup:** choose a player and complete its connection. Choose how viewers request songs here. A desktop companion must be prepared before opening the music app through Groby's Deck.
- **Twitch Integration → Connection:** connect your channel and select the permissions needed by the features you use.
- **Twitch Integration → Rewards & automations:** public presets are available before login. Choose a preset to edit a draft; review permissions, save and enable it when ready. Channel Points rewards are optional.
- **Lights → Pair & assign:** pair or add fixtures first, then assign them and try controls. Add your own devices and explicitly apply a public lighting profile. Public profiles contain colors and brightness, with no device addresses or assignments.
- **Dashboard → Button deck:** Add a button offers public action presets. Deck settings includes public appearance profiles. Choosing a draft or style does not execute a button.

## Built-in viewer controls

| Feature | Chat fallback when no reward is linked |
| --- | --- |
| Change lights | `!color blue` (`!colour`, `!lights`) |
| Teach color | `!teachcolor ocean #123abc` (`!teach`, `!teachcolour`) |
| Song Request | `!sr artist song` (`!songrequest`) |
| Add to playlist | `!addtoplaylist artist song` (`!playlistadd`, `!addsong`) |

These controls stay in the automation list while their feature is available. Connecting a reward does not remove the built-in control. Deleting its reward returns an enabled control to chat fallback. Disabling a built-in control disables its fallback.

The saved **Song Request → Setup → Request method** takes precedence: selecting **Chat commands** keeps `!sr` available even if the Channel Points automation is absent, disabled or paused. The request-mode deck button changes this same preference in both directions. Selecting Channel Points without a linked reward retains chat fallback until one is linked; it does not silently change the saved preference.

**Pause rewards & chat intake** pauses viewer commands and managed redemptions, including on channels with no Channel Points rewards. Per-reward pause controls pause the corresponding built-in chat intake too. Switching request mode never clears this pause. Song Request's own queue pause, moderation and command access rules still apply. Resuming rewards cannot reopen a paused or unverified song queue.

## Public catalogs and personal settings

Shipped catalogs include chat and event recipes, button action drafts, seven lighting profiles, ten deck appearance profiles and fourteen app color profiles. Public appearance changes retain button actions and artwork. Personal profiles and actions remain editable. No public preset supplies an account, token, playlist, local device address or OBS scene binding.

If a package fails to start, Packages and the retained workspace show a classified startup code and a copyable report. The report contains package name/version and lifecycle, without raw private paths or account settings. Saved settings that cannot be read are preserved for recovery rather than replaced with defaults.

## Design evidence

The changes use contextual next actions and useful empty states, following [Nielsen Norman Group's empty-state guidance](https://www.nngroup.com/articles/empty-state-interface-design/). Public catalogs therefore remain visible before account setup. The approach uses consistent destinations and shallow navigation as described in [Microsoft's navigation guidance](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics); it avoids a mandatory setup wizard.

Selected request method, chat fallback, reward state and intake pause remain distinct so the interface can communicate current behavior, following [visibility of system status](https://www.nngroup.com/articles/visibility-system-status/). [Streamer.bot's command model](https://docs.streamer.bot/guide/core/commands) also distinguishes command enablement, aliases, access and cooldowns. [Its Twitch integration guidance](https://docs.streamer.bot/guide/platforms/twitch) distinguishes rewards and their pause state. Status text updates without moving keyboard focus, consistent with [WCAG status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

Regression coverage exercises an empty runtime with both shipped packages, disconnected Twitch, public preset drafts, direct setup links, independent mode/pause policies and delayed settings reads. The reported remote PC's exact startup error was unavailable; the reproduced slow-storage startup failure is fixed, but it does not establish the cause of that particular PC's failure.
