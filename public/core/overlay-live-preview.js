/** Live editing uses expiring interests; sample events stay in this browser only. */
/* global OverlayRenderer, OverlayGameRules, OverlayModel, createOverlayChatFeed */
globalThis.setupOverlayLivePreview = (a) => {
  let live = {},
    sample = OverlayRenderer.samples(),
    events = [],
    games = {},
    pageActive = true,
    studioVisible = true,
    session,
    clock;
  const $ = a.$;
  const chat = createOverlayChatFeed(() => a.renderContent());
  const sampleMode = () => $("previewSource").value === "sample";
  const visible = () => pageActive && studioVisible && !document.hidden;
  const currentInterests = () =>
    JSON.stringify(a.doc.widgets.filter(OverlayModel.usesLiveData).map(OverlayModel.interest));
  function interestChanged() {
    const interests = currentInterests();
    const existing = session;
    syncSession(interests);
    syncClock();
    if (!session || session !== existing || session.pending || interests === session.interests)
      return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => poll(), 80);
  }
  function data() {
    events = events.filter((row) => Date.now() - row.at < 300000);
    const source = sampleMode() ? sample : chat.merge(live);
    return {
      ...source,
      ...(source === sample ? { games } : {}),
      events: [...(source.events || []), ...events],
    };
  }
  function release(client) {
    return fetch("/api/stream-overlays/preview-data/" + client.id, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }
  async function poll(interests = currentInterests()) {
    const client = session;
    if (!client || client.pending) return;
    client.pending = true;
    client.interests = interests;
    try {
      const next = await a.request("/preview-data", "POST", {
        clientId: client.id,
        widgets: JSON.parse(client.interests),
        fast: true,
      });
      if (session === client) {
        live = next;
        $("feedStatus").textContent =
          live.goalStorageError ||
          live.gameStorageError ||
          (live.connected ? "Live Twitch feed" : "Twitch disconnected");
      }
    } catch (error) {
      if (session === client) {
        live = {};
        $("feedStatus").textContent = "Live feed unavailable: " + error.message;
      }
    }
    client.pending = false;
    if (session !== client) {
      // A POST can finish after its first DELETE. Release that session again.
      void release(client);
      return;
    }
    const fast = a.doc.widgets.some(OverlayGameRules.responsive);
    syncChat();
    client.timer = setTimeout(
      () => poll(),
      currentInterests() !== client.interests ? 80 : fast ? 500 : 2000,
    );
    a.renderContent();
  }
  function syncClock() {
    const timedSample =
      sampleMode() &&
      a.doc.widgets.some(
        (widget) =>
          OverlayGameRules.responsive(widget) ||
          (widget.visible && ["activity", "chat", "soundboard"].includes(widget.type)),
      );
    if (!visible() || (!OverlayRenderer.needsClock(a.doc) && !timedSample)) {
      clearTimeout(clock);
      clock = null;
    } else if (!clock) {
      clock = setTimeout(() => {
        clock = null;
        if (visible()) a.renderContent();
        syncClock();
      }, 1000);
    }
  }
  function syncChat() {
    chat.sync(
      visible() && !sampleMode() && a.doc.widgets.some((w) => w.visible && w.type === "chat"),
    );
  }
  function syncSession(interests = currentInterests()) {
    syncChat();
    const wantsLive = visible() && !sampleMode();
    if (wantsLive && interests !== "[]") {
      if (!session) {
        session = { id: globalThis.GrobyRandomId(), pending: false };
        $("feedStatus").textContent = "Connecting live feed...";
        void poll(interests);
      }
    } else if (session) {
      const previous = session;
      session = null;
      clearTimeout(previous.timer);
      void release(previous);
    }
    if (wantsLive && interests === "[]") {
      live = {};
      if ($("feedStatus").textContent !== "No live data needed")
        $("feedStatus").textContent = "No live data needed";
    }
  }
  function sync() {
    syncSession();
    syncClock();
    if (visible()) a.renderContent();
  }
  function open(w) {
    if (w?.type === "chat") $("sampleEvent").value = "channel.chat.message";
    else if (w?.events?.length) $("sampleEvent").value = w.events[0];
    if (w && !["chat", "alerts", "activity"].includes(w.type)) {
      $("previewSource").value = "sample";
      $("previewSource").dispatchEvent(new Event("change"));
      a.notice(
        "Showing editable widgets with sample data. Switch Data to Live to return to your feed.",
      );
      return;
    }
    $("testDialog").showModal();
  }
  $("testWidgets").onclick = () => open(a.selected()[0]);
  $("previewSource").onchange = () => {
    sample = OverlayRenderer.samples();
    events = [];
    games = {};
    $("feedStatus").textContent = sampleMode() ? "Sample data only" : "Connecting live feed...";
    sync();
  };
  $("emulate").onclick = () => {
    const type = $("sampleEvent").value,
      now = Date.now();
    if (events.length >= 100) events.shift();
    events.push({
      id: globalThis.GrobyRandomId(),
      sequence: now,
      type,
      sample: true,
      name: $("sampleName").value.trim() || "DemoViewer",
      login: ($("sampleName").value.trim() || "DemoViewer").toLowerCase(),
      isAppMessage: $("sampleBot").checked,
      color: "#c9a8ff",
      amount: Math.max(0, Number($("sampleAmount").value) || 0),
      tier: $("sampleTier").value,
      currency: type === "channel.charity_campaign.donate" ? "USD" : "",
      message:
        type === "channel.chat.message"
          ? $("sampleMessage").value || "Hello from the sample chat!"
          : type === "channel.follow"
            ? "followed"
            : type === "channel.raid"
              ? "raided with 25 viewers"
              : type === "channel.cheer"
                ? "cheered 100 Bits"
                : "subscribed",
      at: now,
    });
    $("testDialog").close();
    a.renderContent();
  };
  $("clearSamples").onclick = () => {
    events = [];
    sample.events = [];
    a.renderContent();
  };
  $("sampleAll").onclick = () => {
    $("previewSource").value = "sample";
    $("previewSource").dispatchEvent(new Event("change"));
    $("testDialog").close();
  };
  sync();
  const applyProfile = (value) => {
    if (["normal", "compact", "spacious", "sidebar"].includes(value))
      document.documentElement.dataset.workspaceProfile = value;
  };
  if (parent === window)
    fetch("/api/presentation/navigation", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (result.ok) applyProfile(result.profile);
      })
      .catch(() => {});
  document.addEventListener("visibilitychange", sync);
  const redrawVisible = () => {
    if (visible()) a.renderContent();
  };
  document.fonts?.addEventListener("loadingdone", redrawVisible);
  document.fonts?.addEventListener("loadingerror", redrawVisible);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", redrawVisible);
  addEventListener("message", (event) => {
    if (
      parent === window ||
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.type !== "overlay-studio-visibility"
    )
      return;
    applyProfile(event.data.profile);
    const next = event.data.visible !== false;
    if (studioVisible === next) return;
    studioVisible = next;
    sync();
  });
  addEventListener("pagehide", () => {
    pageActive = false;
    sync();
  });
  addEventListener("pageshow", () => {
    if (pageActive) return;
    pageActive = true;
    sync();
  });
  async function control(w, operation, input = {}) {
    if (sampleMode()) {
      const byDoc = (games[a.doc.id] ??= {});
      const before =
        byDoc[w.id]?.signature === OverlayGameRules.signature(w)
          ? byDoc[w.id]
          : OverlayGameRules.initial(w);
      const random = (n) => {
        const limit = Math.floor(4294967296 / n) * n;
        let value;
        do {
          value = crypto.getRandomValues(new Uint32Array(1))[0];
        } while (value >= limit);
        return value % n;
      };
      byDoc[w.id] = OverlayGameRules.control(before, w, operation, input, Date.now(), random);
      a.renderContent();
      a.notice("Sample only. Live widgets were not changed.");
      return;
    }
    if (!a.doc.id)
      throw Error("Save this overlay first, or switch Data to Sample to try it locally.");
    const saved = a.savedWidget(w.id);
    if (
      OverlayGameRules.boardTypes.includes(w.type) &&
      (!saved ||
        OverlayGameRules.signature(saved) !== OverlayGameRules.signature(w) ||
        (w.type === "challenge-board" &&
          operation === "mark" &&
          saved.tiles[input.cell - 1]?.id !== w.tiles[input.cell - 1]?.id) ||
        (w.type === "bingo" && saved.freeCenter !== w.freeCenter))
    )
      throw Error("Save the board layout before changing live marks.");
    await a.request("/game-control", "POST", {
      documentId: a.doc.id,
      widgetId: w.id,
      operation,
      revision: a.revision(),
      ...input,
    });
    live = await a.request("/data");
    a.renderContent();
    a.notice("Live widget updated.");
  }
  a.gameControl = control;
  return { data, open, control, interestChanged };
};
