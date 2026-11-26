/**
 * Player spotify.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#song-requests-providers-and-playback
 */
/* exported installSpotifyPlayer */
function installSpotifyPlayer({ showView, volumeControls }) {
  const active = () => $("songPlayerProvider").value === "spotify";
  const api = (method, payload = {}) => call("song.spotify.player.v1", method, payload);
  const explain = (code) =>
    ({
      spotify_close_client_required:
        "Fully quit Spotify, including its tray icon, then try Open Spotify with Groby’s Deck again.",
      spotify_local_device_unverified:
        "Start a song on this computer in Spotify. Remote Spotify Connect devices cannot receive requests here.",
      spotify_companion_unavailable: "Open Setup and launch Spotify with Groby’s Deck.",
      spotify_not_installed: "Install Spotify Desktop, then choose Prepare companion.",
      spotify_setup_required: "Choose Prepare companion first.",
      spotify_desktop_search_rejected:
        "Spotify rejected catalog lookup. Check that you are signed in and try again.",
      spotify_match_not_found:
        "No close match passed your song filters. Try a more precise artist and song name.",
      spotify_delivery_needs_review:
        "Delivery is unconfirmed. Check Spotify before sending this request again.",
      spotify_native_queue_full: "Spotify has 10 upcoming requests. This request will wait here.",
      spotify_source_changed: "Spotify was updated. Choose Prepare companion again.",
      spotify_state_invalid:
        "Groby’s Deck could not read the saved Spotify settings or request history. Your saved files were kept.",
      spotify_pairing_invalid:
        "Groby’s Deck could not read the saved Spotify pairing. Your saved files were kept.",
      spotify_playback_snapshot_changed:
        "Spotify playback changed while checking the queue. Waiting for a fresh status.",
      spotify_connection_timeout:
        "Spotify opened but the companion did not connect. If its window is blank, quit Spotify completely and open it normally to recover playback, then Prepare companion again. Your Spotify installation and playlists are unchanged.",
      spotify_platform_patch_invalid:
        "This Spotify version cannot be patched safely. No companion was prepared. Use normal Spotify playback or the official Premium connection while this client version is reviewed.",
      spotify_platform_hook_unavailable:
        "This Spotify version has an unsupported desktop layout. Use normal Spotify playback or the official Premium connection.",
      spotify_snapshot_loader_unavailable:
        "This Spotify version has an unsupported startup layout. No companion was prepared. Use normal Spotify playback or the official Premium connection.",
      spotify_store_alias_unavailable:
        "Windows could not find the Spotify Store launch alias. Enable Spotify under Windows Settings > Apps > App execution aliases, or use the regular Spotify installer.",
      spotify_playback_restricted:
        "Spotify restricted this playback action for the current account or song.",
      spotify_mode_has_requests:
        "Finish or resolve existing Spotify requests before changing connection mode, account or device.",
      spotify_device_selection_required:
        "Open Setup, refresh devices and choose an active Spotify device.",
      spotify_account_or_app_access_required:
        "Spotify denied access. Check Premium and your developer app Users and Access allowlist.",
      spotify_premium_required:
        "The official playback API requires a Spotify Premium account. Use the free companion instead.",
      spotify_oauth_setup_required: "Add your Spotify developer app client ID in Setup first.",
      spotify_client_id_invalid:
        "Enter the 32-character client ID from your Spotify developer app.",
      spotify_sign_in_required: "Sign in with Spotify in Setup.",
      spotify_rate_limited: "Spotify is limiting API requests. Wait before trying again.",
      spotify_queue_removal_unsupported:
        "The Spotify official API cannot remove queued songs. The restriction is saved for future requests.",
      spotify_item_already_queued: "This song is already in the selected Spotify device queue.",
    })[code] || code;
  let launchError = false;
  let state = null,
    refreshing = null,
    stopped = false,
    rendered = "";
  const setup = document.createElement("section");
  setup.id = "spotifySetup";
  setup.className = "tidalStep";
  setup.hidden = true;
  setup.innerHTML =
    '<h2>Spotify Desktop</h2><p>Connect the Spotify app on this PC. Your personal playlist stays intact; requests join the queue in order.</p><ol><li>Choose Prepare companion below.</li><li>Quit Spotify completely, including its tray icon.</li><li>Choose Open Spotify with Groby’s Deck, then sign in. Requests can queue while Spotify is paused.</li></ol><div class="actions"><button id="spotifyPrepare">Prepare companion</button><button id="spotifyLaunch" class="primary">Open Spotify with Groby’s Deck</button><button id="spotifyCheck">Check connection</button></div><p id="spotifySetupStatus" role="status"></p><p class="tidalFinePrint">Use Open Spotify with Groby’s Deck each time you want song requests. A normal Spotify launch does not load the companion. Free account playback and skip restrictions still apply. Spotify updates may require Prepare companion again.</p>';
  setup.querySelector("#spotifyLaunch").disabled = true;
  const setupFeedback = document.createElement("p");
  setupFeedback.id = "spotifySetupFeedback";
  setupFeedback.setAttribute("role", "status");
  setup.querySelector("#spotifySetupStatus").after(setupFeedback);
  const regionHelp = document.createElement("p");
  regionHelp.className = "tidalFinePrint";
  regionHelp.append("Spotify uses the country saved on your Spotify account. ");
  const regionLink = document.createElement("a");
  regionLink.href = "https://www.spotify.com/account/profile/";
  regionLink.target = "_blank";
  regionLink.rel = "noopener noreferrer";
  regionLink.textContent = "Open Spotify country settings";
  const regionInstructions = document.createElement("a");
  regionInstructions.href = "https://support.spotify.com/article/country-region-settings/";
  regionInstructions.target = "_blank";
  regionInstructions.rel = "noopener noreferrer";
  regionInstructions.textContent = "Free and Premium instructions";
  regionHelp.append(regionLink, " · ", regionInstructions);
  setup.append(regionHelp);
  $("songSetupPage").append(setup);
  const playback = document.createElement("section");
  playback.id = "spotifyPlayback";
  playback.hidden = true;
  playback.innerHTML =
    '<div><h2>Spotify Desktop</h2><p id="spotifyConnection" role="status">Checking connection…</p></div><div class="actions"><button id="spotifyPause">Pause</button><button id="spotifyResume">Resume</button><button id="spotifySkip">Skip</button><button id="spotifyOpenSetup">Setup</button></div>';
  const playbackLaunch = document.createElement("button");
  playbackLaunch.id = "spotifyPlaybackLaunch";
  playbackLaunch.className = "primary";
  playbackLaunch.textContent = "Open Spotify with Groby’s Deck";
  playbackLaunch.hidden = true;
  playbackLaunch.disabled = true;
  playback.querySelector(".actions").prepend(playbackLaunch);
  document.querySelector(".playerSide").prepend(playback);
  const current = document.createElement("div");
  current.id = "spotifyCurrentActions";
  document.querySelector(".now").append(current);
  const style = document.createElement("style");
  style.textContent =
    "#spotifyPlayback{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}#spotifyPlayback h2{font-size:15px;margin:0}#spotifyPlayback p{font-size:12px;color:var(--muted);margin:5px 0}#spotifyCurrentActions{grid-column:1/-1}";
  document.head.append(style);
  $("spotifyOpenSetup").onclick = () => showView("setup");
  const desktopStatus = () => state?.desktop || state || {};
  async function action(button, method, payload, message) {
    if (button.disabled) return;
    button.disabled = true;
    const companionAction = method === "setup" && ["prepare", "launch"].includes(payload.action);
    if (companionAction) {
      setupFeedback.textContent =
        payload.action === "prepare" ? "Preparing companion…" : "Opening Spotify…";
      setupFeedback.className = "";
    }
    setNotice("Working…");
    try {
      const result = await api(method, payload);
      if (!result.ok) throw new Error(result.error || result.reason || "Spotify action failed.");
      if (companionAction) setupFeedback.textContent = result.launching ? "" : message;
      setNotice(
        result.launching
          ? "Spotify is opening. Connection status will update automatically."
          : message,
      );
      await refresh();
      await refreshState();
    } catch (error) {
      launchError = method === "setup" && payload.action === "launch";
      if (companionAction) {
        setupFeedback.textContent = explain(error.message);
        setupFeedback.className = "status bad";
      }
      setNotice(explain(error.message), true);
    } finally {
      const desktop = desktopStatus();
      button.disabled =
        ["spotifyLaunch", "spotifyPlaybackLaunch"].includes(button.id) &&
        Boolean(desktop.connected || desktop.launching || !state?.installation?.prepared);
    }
  }
  const accountUI = installSpotifyAccount({
    setup,
    api,
    action,
    refresh,
    explain,
  });
  $("spotifyPrepare").onclick = (event) => {
    const url = new URL(location.origin);
    url.hostname = "127.0.0.1";
    return action(
      event.currentTarget,
      "setup",
      { action: "prepare", coreUrl: url.origin },
      "Companion prepared. Fully quit Spotify, then choose Open Spotify with Groby’s Deck.",
    );
  };
  $("spotifyLaunch").onclick = playbackLaunch.onclick = (event) =>
    action(
      event.currentTarget,
      "setup",
      { action: "launch" },
      "Spotify is opening. Sign in there to finish connecting.",
    );
  $("spotifyCheck").onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await refresh();
    } finally {
      button.disabled = false;
    }
  };
  for (const name of ["Pause", "Resume", "Skip"])
    $("spotify" + name).onclick = (event) =>
      action(
        event.currentTarget,
        "control",
        {
          action: name.toLowerCase(),
          ...(name === "Skip" ? { currentUid: state?.current?.uid } : {}),
        },
        "Spotify " + name.toLowerCase() + " requested.",
      );
  async function refresh() {
    if (!active() || stopped) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        state = await api("status", null);
        if (!state.ok) throw new Error(state.error || "spotify_companion_unavailable");
        const desktop = desktopStatus();
        accountUI.render(state);
        volumeControls?.spotifyStatus(state);
        const desktopMessage = desktop.launching
          ? "Opening Spotify Desktop. Waiting for the companion…"
          : desktop.launchError
            ? explain(desktop.launchError)
            : state.installation?.error
              ? explain(state.installation.error)
              : desktop.ready
                ? "Connected. Requests queue automatically."
                : desktop.connected
                  ? desktop.localDevice
                    ? "Connected. Waiting for Spotify queue information."
                    : "Connected. Select this computer as the playback device in Spotify."
                  : state.installation?.prepared
                    ? "Desktop companion disconnected. Open Spotify with Groby’s Deck."
                    : "Desktop companion disconnected. Prepare the companion to enable Open Spotify.";
        const message =
          state.sameDevice && desktop.ready
            ? "Connected - companion queue and official Premium controls"
            : state.mode === "official"
              ? state.lastError
                ? explain(state.lastError)
                : state.ready
                  ? "Premium connected - requests queue on your selected device"
                  : state.account?.connected
                    ? "Choose an active Spotify device in Setup"
                    : "Connect your Premium account in Setup"
              : desktopMessage;
        $("spotifyConnection").textContent = message;
        $("spotifySetupStatus").textContent = desktopMessage;
        $("spotifyLaunch").disabled =
          !state.installation?.prepared || desktop.connected || desktop.launching;
        $("spotifyLaunch").textContent = playbackLaunch.textContent = desktop.launching
          ? "Opening Spotify..."
          : "Open Spotify with Groby’s Deck";
        playbackLaunch.hidden = Boolean(desktop.connected || !state.installation?.prepared);
        playbackLaunch.disabled = Boolean(desktop.launching);
        if (desktop.connected && launchError) {
          launchError = false;
          setupFeedback.textContent = "";
          setNotice("Spotify connected. The previous launch warning is cleared.");
        }
        for (const name of ["Pause", "Resume", "Skip"])
          $("spotify" + name).disabled =
            !state.controlsAvailable || (name === "Skip" && !state.current?.uid);
        renderQueue();
        if (state.queue?.length) await api("flush");
      } catch (error) {
        $("spotifyConnection").textContent = $("spotifySetupStatus").textContent = explain(
          error.message,
        );
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }
  async function moderateSpotify(payload, message) {
    await moderate({ ...payload, provider: "spotify" }, message);
    rendered = "";
    await refresh();
  }
  function renderQueue() {
    if (!active()) return;
    const rows = new Map((state?.queue || []).map((row) => [row.id, { ...row, phase: "waiting" }]));
    for (const row of state?.handoffs || [])
      if (["pending", "unknown", "appended", "playing", "failed"].includes(row.phase))
        rows.set(row.entryId, { ...row, id: row.entryId });
    $("queueHeading").textContent =
      `Spotify requests · ${state?.capacity?.queued || 0} / 10 in Spotify · ${state?.queue?.length || 0} waiting`;
    const signature = JSON.stringify([
      [...rows.values()],
      state?.current?.uid,
      state?.ready,
      state?.mode,
    ]);
    if (
      rendered === signature ||
      ($("queue").contains(document.activeElement) && document.activeElement.tagName === "SELECT")
    )
      return;
    rendered = signature;
    const body = $("queue");
    body.replaceChildren();
    const description = {
      waiting: "Waiting for a slot",
      pending: "Sending",
      unknown: "Delivery unconfirmed · check Spotify",
      appended: "Queued in Spotify",
      playing: "Now playing",
      failed: "Not delivered · check Setup",
    };
    for (const item of rows.values()) {
      const row = body.insertRow();
      row.insertCell().textContent = item.candidate?.title || "Spotify track";
      row.insertCell().textContent = item.requesterLabel || "Requester not recorded";
      row.insertCell().textContent = description[item.phase];
      const actions = row.insertCell();
      actions.className = "rowActions";
      const controls = document.createElement("div");
      controls.className = "rowActions";
      const remove = actionButton("REMOVE", "Remove this request only", () =>
        moderateSpotify({ action: "remove", entryId: item.id }, "Request removed."),
      );
      remove.disabled =
        item.phase === "pending" ||
        item.phase === "unknown" ||
        (item.nativeRemoval === false && item.phase === "appended");
      if (item.nativeRemoval === false && item.phase === "appended")
        remove.title = "The Spotify official API cannot remove individual queued songs.";
      controls.append(remove, createTrackModeration(item, moderateSpotify));
      actions.append(controls);
      if (["unknown", "failed"].includes(item.phase)) {
        const matches = item.possibleMatches || [];
        const review = actionButton(
          matches.length === 1 ? "CONFIRM MATCHING ENTRY" : "NOT IN SPOTIFY - RETRY",
          "Check Spotify first. This explicitly resolves the uncertain delivery.",
          async () => {
            try {
              const result = await api("review", {
                entryId: item.id,
                decision: matches.length === 1 ? "adopt" : "absent",
                ...(matches.length === 1 ? { uid: matches[0].uid } : {}),
              });
              if (!result.ok) throw new Error(result.error);
              rendered = "";
              await refresh();
            } catch (error) {
              setNotice(explain(error.message), true);
            }
          },
        );
        review.disabled = !state?.ready || matches.length > 1;
        actions.append(review);
      }
    }
    if (!rows.size) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 4;
      cell.className = "empty";
      cell.textContent = "No Spotify requests";
    }
    current.replaceChildren();
    current.hidden = !state?.current;
    if (state?.current) {
      const song = state.current,
        owner = song.requesterKey ? song.requesterLabel : "";
      const label = document.createElement("p");
      label.className = "currentRequester";
      label.textContent = owner ? "Requested by " + owner : "No requester recorded for this song";
      const item = {
        id: song.entryId || song.uid,
        candidate: song.candidate || {
          provider: "spotify",
          providerItemId: song.trackId,
          title: song.title,
        },
        requesterKey: song.requesterKey,
        requesterLabel: song.requesterLabel,
      };
      current.append(
        label,
        createTrackModeration(item, (payload, message) =>
          moderateSpotify({ ...payload, currentUid: song.uid }, message),
        ),
      );
    }
  }
  function select() {
    setup.hidden = playback.hidden = current.hidden = !active();
    if (!active()) return;
    document.body.classList.add("tidal-mode");
    player?.pauseVideo?.();
    $("playerFrame").hidden = startPlayer.hidden = $("skip").hidden = true;
    $("catalogSettings").hidden = true;
    $("titleInput").closest("label").hidden = true;
    $("minimumSubscribers").closest("label").hidden = true;
    $("minimumViews").closest("label").hidden = true;
    $("allowNonMusic").parentElement.hidden = true;
    document.querySelector(".volumeControl").hidden = true;
    const requesters = $("requesters").closest("table");
    requesters.hidden = true;
    requesters.previousElementSibling.hidden = true;
    $("playerProviderHint").textContent = "Search songs · queue in order in Spotify Desktop";
    $("videoInput").placeholder = "Artist and song, YouTube, Spotify, or TIDAL track link";
    $("queue").closest("table").querySelectorAll("th")[2].textContent = "STATUS";
    $("clear").textContent = "CLEAR WAITING REQUESTS";
    $("requestNotice").textContent =
      "Accepted requests are sent in order. Up to 10 upcoming requests stay in Spotify; extra requests wait here.";
    rendered = "";
    void api("monitor")
      .then(() => refreshState())
      .catch((error) => setNotice(explain(error.message), true));
    void refresh();
  }
  async function submit(event) {
    event?.preventDefault();
    const query = $("videoInput").value.trim();
    if (!query) return setRequestNotice("Enter an artist and song or Spotify track link.", true);
    $("addSong").disabled = true;
    setRequestNotice("Finding your song in Spotify…");
    try {
      const result = await api("submit", {
        query,
        requestId: globalThis.GrobyRandomId(),
      });
      if (!result.ok) throw new Error(result.reason || result.error || "Song could not be added.");
      $("videoInput").value = "";
      setRequestNotice(
        "Added " + (result.entry?.candidate?.title || "song") + " · sending to Spotify.",
      );
      await refresh();
    } catch (error) {
      setRequestNotice(explain(error.message), true);
    } finally {
      $("addSong").disabled = false;
    }
  }
  const timer = setInterval(() => {
    if (active()) void refresh();
  }, 2000);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
  });
  return { select, refresh, renderQueue, submit };
}
