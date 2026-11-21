# Twitch rewards, events and timers

## Custom command syntax

Use the [command language guide](COMMAND-VARIABLES.md) for the canonical syntax, saved values, random choices, conditions and complete editable recipes. The in-app **Syntax & examples** table and **Insert variable** picker share the same reference. Preview never posts chat or saves records.

The D20 arena is a data-only example: every roll, difficulty adjustment, outcome, XP award and story is editable public syntax. Self-fights do not change XP, wins, losses, ratings or streaks. The automated stress test recreates it with all fight-specific backend modules blocked.

**Seasons & records** includes disabled examples for two-month calendar seasons, a confirmed manual XP reset and archived standings. They use general saved-value functions rather than special season logic. See [saved leaderboards and seasons](COMMAND-VARIABLES.md#saved-leaderboards-resets-and-seasons).

Command access levels are everyone, subscribers/founders, VIPs, moderators and broadcaster, with independent global and per-user cooldowns. Higher levels also qualify. Access checks run before templates or saved changes. Viewer arguments remain literal data.

Older imported templates are converted when loaded or saved, preserving names, totals, roles, cooldowns, aliases and enabled states. A private local backup precedes storage migration.

Open **Twitch Integration → Rewards & automations**. Choose **New automation**,
select its **When** trigger, then connect actions, conditions and waits using the
same builder as deck buttons. For a new Channel Points reward, **Save & create Twitch reward** saves the flow
and creates its reward together. Saving never executes the flow.

The management list separates **Chat commands**, **Channel Points** and **Timers &
events**. Each category has its own list; scrolling never continues into another
category. Entries automatically sort
by command/name, with natural number order (Timer 2 before Timer 10). Search and
the category buttons narrow the list. Each row shows its response/flow, cooldowns
and access level; use its switch to enable/pause it or **Edit** to expand it in
place. Example commands stay in a collapsible recipe section.

**Aliases and phrase triggers** uses compact pills. Type a whole name or phrase
and press Enter; spaces and commas stay inside the entry. Other command names
automatically get a leading `!`. Remove a pill with its hover control (always
visible on touchscreens), or press Backspace or backslash in an empty input to
remove the last. Pasting a list creates multiple pills; duplicate entries are
ignored. Unfinished input is included when saving. The clip title filter uses
the same control for blocked words and allowed exceptions.

On Connection, permission choices remain editable during a pending login. Start
a replacement login for changed choices, save choices to cancel the older login,
or choose **Cancel pending login**. These operations preserve existing granted
access until a new authorization is successfully validated.

| Trigger        | Options                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Channel Points | Bind an app-manageable reward or save and create a new reward in one step.                                                      |
| Chat command   | Choose a command, minimum role and cooldown. Built-in song and clip commands keep their existing handlers.                      |
| Timer          | Repeat every interval, a fixed number of times or indefinitely; optionally count only live time and require chat activity.      |
| Twitch event   | Follow, subscribe, resub message, gift subscriptions, Bits, incoming raid, stream online/offline, ad break, Hype Train or poll. |

The four built-in handlers remain choices: lighting, teach colour, Song Request
and add to playlist. Their existing rewards appear as editable automations. You
can replace a handler with a custom flow or remove its automation. Removing an
automation keeps its actual Twitch reward and refunds later redemptions without
running the removed handler. **Delete reward on Twitch** is a separate confirmed
action; the automation remains a disabled draft.

Reward details include title, cost, prompt, viewer text input, colour, visibility,
pause, per-stream/per-viewer limits and a global cooldown. Twitch permits editing
and deletion only for rewards created by the same Twitch application. Deleting
a reward may fulfil its outstanding redemptions on Twitch. [Twitch Channel Points API](https://dev.twitch.tv/docs/api/reference/channel-points/)

## Timers that wait for chat

For a reminder every 30 minutes, choose **Timer**, set **Repeat every** to 30 and
add **Send a chat message**. A repeat count of 0 means infinite. **Only count time
while live** pauses the countdown offline or when live status cannot be confirmed.

**Require new chat messages per run** counts viewer messages since the previous
run. At the end of the interval, an unmet message threshold holds the timer until
enough messages arrive, then runs once. Duplicate messages and messages from the
broadcaster do not count. Paused timers do not collect activity; live-only timers
also ignore offline chat. Each successful admission resets the interval and count.
Missed intervals never create a catch-up burst.

**Pause** retains remaining time. **Start** resumes it; **Restart timer** resets
its count and interval. Core must remain running. After a Core restart, enabled
timers start a fresh interval and do not replay missed actions.

## Subscriber messages and raid shoutouts

The **Subscriber thank-you**, **Raid shoutouts** and **Chat timer** starters load
editable drafts. They do not create Twitch rewards. Event permissions are optional
groups on **Connection**; select the relevant group and reconnect to grant it.
Only the event types used by enabled automations are subscribed. [Twitch EventSub reference](https://dev.twitch.tv/docs/eventsub/reference/channel)

Chat and announcement text support `{user}`, `{raider}`, `{viewers}`, `{bits}`,
`{months}`, `{gifts}` and `{event}`. Values come from the triggering Twitch event.
In If blocks, **Twitch event values** supplies numeric raid viewers, Bits,
subscription months and gift counts. Event values are never substituted into
desktop input, executable targets or OBS parameters.

Choose **Send a native shoutout**, **Send a bot shoutout**, or put both in a
**Together** block. Native shoutouts need the optional shoutout permission and a
live stream. Twitch's cooldown is two minutes overall and one hour for the same
recipient. Bot shoutouts send `!so login` or `!shoutout login`; your chosen bot
must recognise that command. [Twitch shoutout API](https://dev.twitch.tv/docs/api/reference/chat)

## Actions and stopping

Every deck action is available through its existing owner and permissions:
OBS, Windows audio, playback, lights, mods and more. Twitch choices also include
chat messages, announcements, starting/snoozing ads and changing the stream title
or category ID. Ads require the optional ad permission and an eligible live
channel; Twitch's availability and cooldown rules apply. No ad rewards are
pre-created. [Twitch ads API](https://dev.twitch.tv/docs/api/reference/ads/)

Use **Remember current values → actions → Wait → Restore previous values** for
a temporary mic switch. Stop/failure/normal shutdown attempts restoration for
supported audio and OBS values. Messages, ads and other irreversible outputs
retain their effects. A sudden process exit cannot send restoration commands.

Saved automations expose **Start/resume**, **Pause**, **Start/pause** and timer
**Restart** actions in the deck library. They also appear in the flow builder,
so a chat command or another flow can control a timer. Pause prevents future
triggers; **Stop & restore** cancels a currently running flow.

Successful custom reward flows fulfil the redemption. A busy/disabled trigger
refunds without running. Partial failures and unconfirmed outcomes remain in
the existing redemption review queue; interrupted flows are never replayed.
Saved settings and deduplication receipts stay in private runtime storage.
