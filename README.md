# Groby’s Deck

<img src="assets/Grobys-Deck.png" alt="Groby’s Deck" width="96" height="96">

**Your stream. Your controls. Your deck.**

Build a modular control surface for your stream, desktop, phone or tablet:

- **Button decks:** music, audio mixers, OBS scenes, microphones, lights and custom actions.
- **Twitch automations:** chat commands, Channel Points rewards, timers, raids and subscriber events.
- **Flow builder:** combine actions, conditions, waits, repeats and temporary changes you can restore.
- **Overlay designer:** named layouts, editable layers, animated widgets, chat and song information.
- **Song requests:** shared moderation for supported music players and Twitch request sources.
- **Smart lighting:** Hue, WiZ and Govee LAN controls, saved scenes and Music-to-Light.

Runs locally on Windows. Twitch and Song Request are optional packages. Your settings and account credentials stay on your PC.

[Download 0.8.1a](https://github.com/NameSRoby/Groby-s-Deck/releases/tag/v0.8.1a) |
[User guide](docs/USER_GUIDE.md) |
[Report a bug](https://github.com/NameSRoby/Groby-s-Deck/issues/new?template=bug_report.yml)

## Install

1. Download **Grobys-Deck-Windows-v0.8.1a-setup-installer.exe**.
2. Run Setup and choose the features you want.
3. Open **Groby’s Deck** from the Start menu or desktop shortcut.

**Portable:** extract **Grobys-Deck-Windows-v0.8.1a-self-contained.zip** completely,
then run **Groby's Deck.exe**.

The runtime and optional packages are included. No developer tools are needed.
Your account sign-ins and online music services still need internet.

<details>
<summary>Windows requirements and other installation options</summary>

- **Windows 10 x64, build 19041 or later**, or Windows 11.
- Music-to-Light app capture needs **build 20348 or later**; Windows 11 is recommended.
- Setup detects WebView2 and runs its bundled offline Evergreen installer only
  when it is missing. Portable users can run **scripts/install-webview2.ps1**.
- The release is unsigned, so Windows may show an unknown-publisher warning.
  Compare downloads with **SHA256SUMS.txt**.
- **Code > Download ZIP** downloads source code. Run **Start-Grobys-Deck.cmd** for
  first-time source setup; it downloads a verified runtime bundle.
- Use a separate folder from an old RaveLink Bridge installation.

[Windows setup guide](docs/WINDOWS_SETUP.md) |
[Source setup](docs/USER_GUIDE.md#source-and-tests)

</details>

## Start here

| Want to...                  | Open                                         |
| --------------------------- | -------------------------------------------- |
| Connect your lights         | **Fixtures**                                 |
| Make lights follow music    | **Lights > Music-to-Light > Audio & lights** |
| Add Twitch or song requests | **Packages**                                 |
| Customize your controls     | **Dashboard > Button deck > Edit**           |
| Use your phone or tablet    | The **network icon**                         |

Core opens in its own desktop window. You can also use
[localhost:5050](http://127.0.0.1:5050) in a browser.
Closing the window keeps Core in the tray; **Groby’s Deck > Exit** stops it.

## Build your button deck

Put your most-used controls on one screen:

- **Music:** playback, volume and request moderation.
- **Lights:** colors, saved profiles and Rave controls.
- **OBS:** scenes, source visibility, microphones and filters.
- **Custom actions:** keyboard shortcuts, macros and approved mod functions.

Press **+** to add a button. Use **Edit** to move it or change its appearance.
Add pages and folders when you need more space.

Choose icons, text, images, GIFs and backlight colors.
Use **Fullscreen** for a dedicated control surface on desktop, phone or tablet.

[<img src="assets/screenshots/dashboard.png" alt="Button deck with music widgets and lighting controls" width="920">](assets/screenshots/dashboard.png)

[Button deck setup and customization](docs/CONTROL_DECK.md)

<details>
<summary>See the OBS button builder</summary>

Connect through **OBS connection**, then choose **Create an OBS button** in the
button editor. OBS 28+ includes the required WebSocket server.

[<img src="assets/screenshots/obs-button-builder.png" alt="OBS button builder" width="760">](assets/screenshots/obs-button-builder.png)

[OBS setup](docs/CONTROL_DECK.md#obs-buttons)

</details>

### Send soundboard audio to a microphone input

Install a VB-CABLE recording and playback pair. In **Soundboard** or a **Play sound file** action, select the **Virtual mic** destination. Select the matching recording device in OBS, Discord or the receiving app. Select headphones as a second destination to hear the clip locally. To combine your physical microphone and soundboard on one input, route both through a virtual mixer such as Voicemeeter. [VB-CABLE setup](https://voicemeter.org/Cable/index.htm) · [Voicemeeter setup](https://voicemeeter.com/setup-voicemeeter-for-skype-zoom-or-discord/)

## Make your lights follow music

1. Open **Audio & lights** and choose your audio source and lights.
2. Allow capture and light output, then calibrate at your usual listening volume.
3. Open **Play**, choose an effect profile and preview it.

Choose matching, custom or random colors. Use **Create** for detailed tuning
and saved effects.

[<img src="assets/screenshots/music-to-light.png" alt="Music-to-Light profiles and palette controls" width="920">](assets/screenshots/music-to-light.png)

[Music-to-Light guide](docs/USER_GUIDE.md#music-to-light) |
[Hue setup](docs/USER_GUIDE.md#hue-entertainment-setup) |
[Govee compatibility](docs/USER_GUIDE.md#govee-lan-compatibility)

## Take song requests

Install **Song Request** from **Packages**, choose a player and follow its Setup page.

Manage requests, moderate viewers and songs, organize playlists, review transfers
and design a now-playing overlay for OBS.

| Player     | How it connects                                      |
| ---------- | ---------------------------------------------------- |
| YouTube    | Search and official embedded playback                |
| SoundCloud | Public search and official widget playback           |
| Spotify    | Desktop companion; optional Premium account controls |
| TIDAL      | Signed-in catalog and desktop companion              |

Availability, accounts, ads and playback restrictions depend on the provider.
Desktop companions may need updating after player changes.

[<img src="assets/screenshots/song-request.png" alt="Song Request player and queue" width="920">](assets/screenshots/song-request.png)

[Player setup and limitations](docs/USER_GUIDE.md#optional-features) |
[Playlists and transfers](docs/USER_GUIDE.md#playlists-and-transfers)

<details>
<summary>See the overlay designer</summary>

Select an object, adjust its layout and choose **Save overlay** to apply changes to OBS. The Twitch chat widget mirrors message deletions, bans, timeouts and chat clears in both the editor and OBS. Open the widget's **Content** settings to control username colors, Twitch badges and emotes from Twitch, 7TV, BetterTTV and FrankerFaceZ.

[<img src="assets/screenshots/overlay-designer.png" alt="Overlay designer canvas and controls" width="920">](assets/screenshots/overlay-designer.png)

</details>

## Connect Twitch

Install **Twitch Integration** from **Packages** and connect your account.
Choose which permissions you want before signing in.

You can enable:

- Song requests through Channel Points or **!sr / !songrequest**.
- Viewer lighting commands and Rave.
- Chat replies and stream clipping.

Core-managed song rewards stay refundable until playback is confirmed.
Widget-only intake requires manual refunds and fulfillment.

<details>
<summary>See Twitch permission settings</summary>

[<img src="assets/screenshots/twitch-permissions.png" alt="Twitch permissions and feature availability" width="760">](assets/screenshots/twitch-permissions.png)

Permission changes apply to your next sign-in. Unchecking an option does not
revoke permissions already granted on Twitch.

</details>

[Community playlist rewards](docs/USER_GUIDE.md#community-playlist-reward)

## Use a phone or tablet

Click the **network icon** to enable access on your private network.
Scan the QR code or copy the link to your other device.

Private-network access gives that device full controls.
The desktop window and localhost remain available.

## What's fixed in 0.8.1a

- Now-playing chat announcements follow the selected player's actual song, including personal playlists and songs that were never requested. Polling, pause/resume and restarts do not repeat the same announcement. Verified requests retain requester credit.
- Includes the earlier 0.8.1 fixes:

- Restores Song Request player selection and saved overlay settings across restarts.
- Repairs subscriber credits, scrolling, wheel animations and full-canvas preview.
- Adds clearer source-specific widget controls, readable watchtime formats and editable name spacing.
- Improves broadcast text styles and alert media variations; expands named Twitch goals and automation presets.
- Preserves settings and sign-ins while keeping local runtime data out of published downloads.

Update the optional **Song Request** and **Twitch Integration** packages under **Packages & updates** to use their latest features.

[Command language](docs/COMMAND-VARIABLES.md) | [Twitch automations](docs/TWITCH_AUTOMATIONS.md) | [Earlier releases](docs/RELEASE_ARCHIVE.md)

## Things to know

- Light features depend on the model, firmware and network. Hue Entertainment
  needs pairing and an area; compatible Govee lights need LAN Control enabled.
- Protected audio may be unavailable. Browser capture does not isolate individual tabs.
- Stop and normal shutdown attempt to restore your lights. A crash, power loss or
  disconnected device can prevent restoration.
- Community mods are third-party code. Review them before activation.

Screenshots use demonstration data and simulated connections.
Automated tests cannot certify every device or account.

[User guide](docs/USER_GUIDE.md) |
[Validation and known limits](docs/REPOSITORY_HEALTH.md)

## Privacy and updates

Settings, credentials, pairings, playlists and logs stay on your PC and are
excluded from published downloads. Services you enable still use the internet.

Updates verify checksums and preserve local data.
Optional packages update separately under **Packages**.

When reporting a bug, include your versions and steps to reproduce it.
Remove tokens, account details and private paths from screenshots and logs.

## Developers and contributors

[Contributing](CONTRIBUTING.md) |
[Developer guide](docs/DEVELOPMENT.md) |
[Mod author guide](docs/MOD_AUTHOR_GUIDE.md) |
[Mod APIs](docs/MOD_API_REFERENCE.md) |
[Application APIs](docs/API_REFERENCE.md) |
[Mod starter](packages/mod-sdk/starter)

## License

Apache-2.0. Third-party code and provider marks retain their own licenses.
See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Earlier versions

Groby’s Deck 0.8 is the current release. Previous releases remain available in the
[release archive](docs/RELEASE_ARCHIVE.md) for reference. Use 0.8.1a for new installations.

Existing settings, secrets, mods and automation data are preserved when upgrading in the same folder.
The internal `ravelink` protocol and storage names remain stable so existing integrations continue to connect.
