# Overlay designer

Open **More > Overlay designer**. This is the full-scene compositor; Song Request's
existing designer continues to edit its detailed music card independently.

## Editing and OBS

- New documents start at **1920 × 1080**. Canvas settings include 720p, 1080p,
  1440p, 4K, portrait, square and custom dimensions from 64 to 8192 pixels per side.
- Applying a different canvas size can either preserve layer sizes or scale the
  layers with the canvas. Zoom changes only the editor's view.
- **Guides** snaps a moving selection to canvas or layer edges and centers.
  Hold Alt to place it freely. **Canvas settings > Show safe margins** adds
  5% and 10% inset guides in the editor. They stay out of Preview and OBS.
- Add a widget, then drag it or resize a corner. Hold Shift to preserve its aspect
  ratio. Click a widget to open its left-side settings. Collapsible sections separate Content, Style, Position and Animation. Canvas settings live in the top toolbar.
- The layer list supports visibility, locking, ordering, duplication, removal and
  grouping. Shift-click selects multiple layers. Arrow keys nudge by one pixel;
  Shift+arrow uses ten. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Y redoes, Ctrl/Cmd+D duplicates,
  and Ctrl/Cmd+S saves. Text fields keep their normal undo behaviour.
- Live data appears while editing, including in unsaved overlays. **Data > Sample**
  switches every data widget to demonstration values; **Data > Live** returns to
  your actual sources. **Preview** hides editing handles without changing the feed.
- New **Supporter credits** rolls start with current Twitch subscribers and begin
  scrolling as soon as Twitch returns names. Switch **Credit names** to Followers
  or My list if needed. Dated subscriber rolls use locally recorded events.
- Twitch chat shows recent messages already received by the connected app and
  new messages as they arrive. It renders native Twitch emotes. Twitch EventSub
  does not replay messages sent before the app began receiving chat.
- **Test widgets** and **Preview a chat message** add a local sample with editable
  name and message. These never post chat, award XP, start an ad or reach OBS.
- Chat's **Content** tab keeps removal mode, lifetime and bot filtering together.
  Messages disappear after **10 seconds** by default; choose 1–300 seconds or keep
  them until newer messages push them out. Animation links back to these settings.
- **Hide app-sent bot messages** recognizes the app's own replies, even under the
  broadcaster's name. Manually typed broadcaster messages remain visible. Add
  other bot usernames as removable pills; Twitch does not identify every bot.
- Save, choose **OBS setup**, and copy the URL into an OBS Browser source. Set its
  width and height to the displayed document dimensions. Its background is
  transparent. Groby’s Deck must run on the OBS computer; this is a local source.
- OBS displays saved documents only. Unsaved edits stay in the editor. Saving in
  another window produces a conflict message rather than overwriting silently.

Under **Style & text > Font**, select **Installed font** to type a family name
or browse fonts when the browser supports and permits it. An installed family
needs to be available on the machine rendering the overlay. Select **Uploaded
font** to use a WOFF, WOFF2, TTF or OTF file up to 5 MB that you can use on stream.
The editor and local OBS output load the same file. Layout exports reference
the file stored on this server.

## Available widgets and their sources

Save a visible **Bingo board** to see it under **Dashboard > Button deck > Bingo**.
Choose 1–10 rows and 1–10 columns and set the square text in the widget's Content
section. The deck gives every square a button. Deck marks, automation actions and
OBS share one board. Rows and columns count toward Bingo. Diagonals also count on
square boards. Changing dimensions clears the marks.

The picker includes only implemented widget types. Music and Twitch entries
appear when their respective packages are active. A widget can be configured
before granting its required Twitch access; the inspector identifies missing access.

| Widgets                                 | Real source                                                    | Requirements / limits                                                                                      |
| --------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Text, shapes/panels                     | Document                                                       | Text, fonts, colors, background, opacity, size, position and rotation                                      |
| Images/GIFs, videos                     | Uploaded media or user-supplied HTTPS URL                      | PNG/JPEG/WebP/GIF; MP4/WebM playback depends on the browser's codecs. Videos are muted                     |
| Clock                                   | Browser clock                                                  | Local time on the OBS computer                                                                             |
| Countdown                               | Saved duration or absolute end time                            | Does not restart on every browser-source refresh; Save publishes its chosen end time                       |
| Manual goal                             | Saved current and target amounts                               | Explicitly manual; not a donation or charity integration                                                   |
| Now playing, request queue              | Existing Song Request playback/queue owner                     | Active Song Request package; no second player or audio engine                                              |
| Stream title, category, viewers, uptime | Existing Twitch Helix dashboard methods                        | Connected Twitch account; offline streams show Offline                                                     |
| Follower count, latest follower         | Existing follower API                                          | `moderator:read:followers`; latest known follow, not a fabricated session label                            |
| Subscriber count, subscription points   | Existing subscriber API                                        | `channel:read:subscriptions`                                                                               |
| Alerts, recent activity                 | Existing EventSub follow/sub/resub/gift/raid/cheer events      | Per-event authorization. Alerts use a bounded queue and editable `${name}`, `${message}`, `${amount}` text |
| Twitch chat                             | Existing chat receive stream and moderation events             | `user:read:chat`; text messages. Deletes, user clears and chat clears remove displayed messages            |
| Poll                                    | Existing poll begin/progress/end events                        | `channel:read:polls`; updates received after subscription; no made-up initial poll                         |
| Hype Train                              | Existing Hype Train begin/progress/end events                  | `channel:read:hype_train`; updates received after subscription                                             |
| Supporter credits                       | Current followers/subscribers and recorded subscription events | Period and vertical/horizontal marquee; current subscriber lists have no historical subscription dates     |
| Media slideshow, rotating text          | User-uploaded media/HTTPS URLs or editable text entries        | Editable time per item, fit and animation                                                                  |
| Custom HTML/CSS/JS                      | Isolated widget frame                                          | Read-only presentation data and JSON fields; no Core capabilities, cookies or network API access           |

There are no charity, tips/payment, merchandise, loyalty-store, contest, giveaway,
emote-cup or KappaGen widgets. These would need
additional providers or rendering systems. StreamElements APIs, widget code and
historical session totals are not emulated. Chat currently renders emote names as
text; it does not claim a 7TV or graphical emote integration. Alerts currently
provide visual text; there is no built-in alert audio/variation system.

## Custom widgets

HTML, CSS, JS and Fields have separate editor views. Fields is a JSON object, for
example `{"greeting":"Welcome!"}`. JavaScript can read it as
`RaveLinkOverlay.fields.greeting`. Subscribe to read-only data updates:

```js
addEventListener("overlay-data", ({ detail }) => {
  document.querySelector("#title").textContent = detail.music?.current?.title || "Nothing playing";
});
```

This is Groby’s Deck's own API, not `SE_API`. The frame has an opaque origin, no
`allow-same-origin`, and a restrictive CSP. Custom code is optional; normal
widgets use form controls and do not require code. Local uploaded files and their
paths are kept in private runtime storage and never copied into publication.

## Runtime budget

There are at most 20 documents, 64 layers each and 240 KB of custom document data
per overlay. Undo history is bounded by count and serialized size. Media uploads
are signature checked: 8 MB per image, 50 MB per video, and 500 MB / 200 assets
per private media library. Unused uploads are retained; there is not yet a media
library cleanup screen.

All OBS clients share one lazy data cache: a two-second music read and up to one
30-second refresh per requested Twitch dashboard source. No client creates a new
Twitch socket. Saved visible widgets and active editor drafts contribute EventSub
subscriptions. Up to eight editor interests expire after 15 seconds without a
refresh; closing an editor releases them. Chat and alert clients refresh twice a
second so short lifetimes work; other feeds refresh every two seconds. Provider
lookups still share the same cache. The app's own messages are presentation data
only and never re-enter chat command triggers.
Activity is bounded to 100 events in memory and one hour; no chat history is
persisted. Account changes clear the event buffer and dashboard cache. Each
alert widget queues up to 20 pending alerts and displays them in order. OBS checks
the document revision rather than repeatedly downloading the full library.

## Research and capability audit (14 November 2026)

The screenshots informed navigation, not a promise to supply StreamElements'
external services. Primary documentation was checked against the application's
actual provider methods and event definitions:

| Primary reference                                                                                                                                                                                        | Decision in Groby’s Deck                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [StreamElements overlay overview](https://docs.streamelements.com/overlays) and [canvas payload](https://docs.streamelements.com/websockets/topics/channel-overlay-update)                               | One transparent browser-source document with independent canvas dimensions and layers                                  |
| [Editor shortcuts](https://docs.streamelements.com/overlays/overlay-editor-shortcuts)                                                                                                                    | Undo/redo, duplication, pixel nudging, selection and groups; independent fit/zoom                                      |
| [Custom widget structure](https://docs.streamelements.com/overlays/widget-structure) and [custom widget API](https://docs.streamelements.com/overlays/custom-widget)                                     | Separate code/field views and an explicitly RaveLink-specific read-only data API                                       |
| [Alert variations](https://docs.streamelements.com/overlays/alertbox-variations) and [session data](https://docs.streamelements.com/overlays/session-data)                                               | Do not advertise advanced variations, imported session statistics or external event sources without implementing them  |
| [OBS Browser Source](https://obsproject.com/kb/browser-source)                                                                                                                                           | Supply matching width/height and transparent output; browser codec and local-server lifetime are real dependencies     |
| [Twitch channel events](https://dev.twitch.tv/docs/eventsub/reference/channel) and [subscription authorization](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/)                               | Use existing authorized follow/sub/raid/cheer/poll/Hype Train events; do not invent data when authorization is missing |
| [Twitch chat reception/moderation](https://dev.twitch.tv/docs/chat/send-receive-messages)                                                                                                                | Forward message-removal and clear events into the bounded presentation buffer                                          |
| [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)                                                                                                        | Custom frames receive scripts without same-origin privileges                                                           |
| [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) and [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) | Pointer capture and touch handling for moves/resizes, with scaled coordinates converted into canvas units              |

Storage and public projections live in `src/domains/overlays`; the editor and OBS
share `public/core/overlay-model.js` and `overlay-renderer.js`. Tests exercise save,
reload, conflicts, real scaled pointer resizing, transparent output, moderation,
source availability, cache fan-in, upload boundaries and custom frame isolation.

## Familiar editing controls

Drag an empty area to select several unlocked layers; Shift adds to the selection.
Right-click the canvas or a widget for copy, paste, duplicate, grouping, ordering,
visibility, locking and delete. Ctrl/Cmd+wheel changes zoom. Alt+F fits the canvas;
Alt+X returns to 100%. Shift+D duplicates; Shift+G groups; Shift+U ungroups.
The existing Ctrl/Cmd shortcuts still work. Escape cancels a drag or deselects.

Navigation and shortcuts were checked against the official [StreamElements overlay
guide](https://support.streamelements.com/hc/en-us/articles/10474479981074-Overlays-The-Complete-Guide-Gallery-OBS-Setup-Widgets-Alerts-Data)
and [editor shortcut reference](https://docs.streamelements.com/overlays/overlay-editor-shortcuts).
Widget capabilities remain those actually supplied by Groby's Deck; external
services and unsupported widget types are not advertised as available.

## Approved widget expansion (21 November 2026)

Open **Add widget** and use the Category filter or search to reach a widget quickly. Recent activity is now called **Event
history** and keeps the existing event source, rather than creating a duplicate.
All the following widgets use the normal layer, style, animation and position
controls. Presets only change editable fields.

| Widget               | Source and controls                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Twitch Predictions   | Current/latest prediction, options, points, viewers and winning option. Enable **Prediction widgets & events** on Connection. Results update through EventSub, with a shared initial/periodic Helix read. |
| Leaderboard          | Select any saved player stat, watchtime, or loyalty points; choose the row limit. Reads the same account-scoped records as commands. Watchtime values are minutes, including imported time.               |
| Player card          | Enter a Twitch username and add saved stat names as pills. No special arena service is required; custom numeric player stats work too. Displaying a card does not create a player.                        |
| Event history        | Follow, sub, resub, gift, raid and cheer filters, with a visible row limit. The existing bounded session event feed is reused.                                                                            |
| Redemption queue     | New pending redemptions arrive live; fulfilled/refunded items disappear. Older pending redemptions are fetched incrementally for app-owned rewards. Viewer-entered redemption text is never exposed.      |
| Custom counter       | Choose the exact saved counter name; displaying its value does not increment it.                                                                                                                          |
| Stream schedule      | Editable weekly rows: day, time, title and timezone. This is an independent schedule, not an imported Twitch calendar.                                                                                    |
| Chat voting          | Editable choices, command and duration. Start, close and reset from the inspector or an automation. Viewers send e.g. `!vote 2`; only the first vote per Twitch user counts.                              |
| Wheel of names       | Editable entry pills, or chat entries using e.g. `!join`. Open/close entries, spin and reset. Colors, duration and removal of a selected entry are editable.                                              |
| Bingo board          | 1–10 rows and columns, editable square text and an optional free center on odd boards. Control it from the Bingo deck tab, inspector or automation actions.                                               |
| Soundboard indicator | Displays native soundboard playback and an optional last-played label (3 seconds by default, editable or off) so short sounds remain visible. Never creates another audio player or changes outputs.      |

### Sample versus live game controls

**Data > Sample** tests the same game rules in this browser, including spins and
marked bingo cells, without saving or changing live widgets. **Data > Live**
controls the saved document. Save changed entries before operating a live game.
Controls display an explanation when Twitch access or a saved document is missing.

Saved widgets appear under **Overlay games** in the normal deck/automation action
catalog: spin, open/close wheel entries, start/close votes, toggle a bingo square,
and reset. Combine these with existing waits and Twitch triggers; there is no
separate automation runner. Saving an overlay never starts a game or posts chat.

Wheel results and bingo marks survive app restarts. Every OBS source sees the same
result; refreshing a browser cannot reroll a wheel. Spins use server-side secure
random selection, with one equally likely slot per entry. Chat entry lists accept
up to 100 unique users. Votes accept up to 20,000 users per game and 100,000 total
across saved games. Voter/entrant IDs stay private and app-sent replies cannot join
or vote. Gameplay data is written at most once a second during chat input; direct
controls commit immediately. Counters and player records remain in the existing
indexed storage, with bounded top-N reads rather than full history loads.

Twitch only permits an app to retrieve older redemptions for rewards that app
created. New redemptions can still arrive from EventSub. Queue backfill reads one
reward every two seconds, pauses 30 seconds after a complete pass, and caps each
reward read at 100 entries; very large queues may be truncated. No remote action
is retried by displaying a widget.

References: [Twitch Predictions API](https://dev.twitch.tv/docs/api/reference/predictions),
[Prediction events](https://dev.twitch.tv/docs/eventsub/reference/prediction/),
[Channel Points API and ownership restrictions](https://dev.twitch.tv/docs/api/reference/channel-points).

### Canvas navigation

Use **Pan**, hold Space while dragging, or drag with the middle mouse button to
pan a zoomed canvas. This changes only the viewport and adds no undo entries.
Ctrl/Cmd+wheel zooms around the pointer; Alt+F returns to Fit. Canvas settings stay
in the top toolbar and selected widget sections remain in the left sidebar.

### Broadcast typography and list spacing (0.8.1)

Credits provide spacing between names, an optional separator, reverse direction,
and a pause control. These settings work in horizontal tickers and vertical
rolls, including the join between repeated groups. The optional label stays above
the scrolling names.

Text styles include broadcast headlines, lower thirds, caption strips, creator
tags, section labels, scoreboards and outlined text. All remain editable: padding,
vertical alignment, letter case, shadow color/blur/offset/opacity, outline width
and accent edges are saved with the widget. A preset changes style, never the
text or layer position. See the [style gallery](../assets/screenshots/overlay-text-styles.png).

Leaderboard source controls are contextual. Custom stats show the saved stat
name; watchtime offers seconds, minutes, hours, days, months, years or a readable
duration. Months mean 30 days and years mean 365 days. Display formatting never
changes stored watchtime or ranking. List rows offer spacing, value text size,
rank-number visibility and inline or stacked values.

Canvas settings includes **Overlay animations**: broadcast motion, device
preference, or reduced motion. It applies equally to the designer and OBS output.
Preview always fits the available canvas; returning to editing restores the
chosen zoom and preserves the document.
