/** Live editing uses expiring interests; sample events stay in this browser only. */
/* global OverlayRenderer, OverlayGameRules, OverlayModel */
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
  const sampleMode = () => $("previewSource").value === "sample";
  const visible = () => pageActive && studioVisible && !document.hidden;
  const currentInterests = () =>
    JSON.stringify(a.doc.widgets.filter((w) => w.visible).map(OverlayModel.interest));
  function interestChanged() {
    if (!session || session.pending || currentInterests() === session.interests) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(poll, 80);
  }
  function data() {
    events = events.filter((row) => Date.now() - row.at < 300000);
    const source = sampleMode() ? sample : live;
    return {
      ...source,
      ...(source === sample ? { games } : {}),
      events: [...(source.events || []), ...events].slice(-100),
    };
  }
  function release(client) {
    return fetch("/api/stream-overlays/preview-data/" + client.id, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }
  async function poll() {
    const client = session;
    if (!client || client.pending) return;
    client.pending = true;
    client.interests = currentInterests();
    try {
      const next = await a.request("/preview-data", "POST", {
        clientId: client.id,
        widgets: JSON.parse(client.interests),
        fast: true,
      });
      if (session === client) {
        live = next;
        $("feedStatus").textContent =
          live.gameStorageError || (live.connected ? "Live Twitch feed" : "Twitch disconnected");
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
    const fast = a.doc.widgets.some(
      (w) => w.visible && ["chat", "alerts", "credits"].includes(w.type),
    );
    client.timer = setTimeout(
      poll,
      currentInterests() !== client.interests ? 80 : fast ? 500 : 2000,
    );
    a.renderContent();
  }
  function tick() {
    if (!visible()) return;
    if (a.doc.widgets.some((widget) => widget.visible)) a.renderContent();
    clock = setTimeout(tick, 1000);
  }
  function sync() {
    const shown = visible();
    if (shown && !sampleMode()) {
      if (!session) {
        session = { id: globalThis.GrobyRandomId(), pending: false };
        void poll();
      }
    } else if (session) {
      const previous = session;
      session = null;
      clearTimeout(previous.timer);
      void release(previous);
    }
    clearTimeout(clock);
    if (shown) tick();
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
    events.push({
      id: globalThis.GrobyRandomId(),
      sequence: now,
      type,
      name: $("sampleName").value.trim() || "DemoViewer",
      login: ($("sampleName").value.trim() || "DemoViewer").toLowerCase(),
      isAppMessage: $("sampleBot").checked,
      amount: type === "channel.raid" ? 25 : 100,
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
  document.addEventListener("visibilitychange", sync);
  addEventListener("message", (event) => {
    if (
      parent === window ||
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.type !== "overlay-studio-visibility"
    )
      return;
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
    await a.request("/game-control", "POST", {
      documentId: a.doc.id,
      widgetId: w.id,
      operation,
      ...input,
    });
    live = await a.request("/data");
    a.renderContent();
    a.notice("Live widget updated.");
  }
  a.gameControl = control;
  return { data, open, control, interestChanged };
};
