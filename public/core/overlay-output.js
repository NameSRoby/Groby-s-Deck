/** Saved output only. The editor's sample events and unsaved draft never reach OBS. */
/* global OverlayRenderer */
(() => {
  const id = new URLSearchParams(location.search).get("id"),
    host = document.getElementById("output");
  let doc = null,
    data = {},
    stopped = false,
    timer,
    revision = -1;
  function draw() {
    if (doc) OverlayRenderer.render(host, doc, data);
  }
  async function poll() {
    try {
      const [library, live] = await Promise.all([
        fetch("/api/stream-overlays/document/" + encodeURIComponent(id) + "?revision=" + revision, {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch("/api/stream-overlays/data?fast=1", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (library.ok) {
        revision = library.revision;
        if (!library.notModified) doc = library.document || null;
        if (!doc) host.replaceChildren();
      }
      data = live.ok ? live : {};
      draw();
    } catch {
      data = {};
      draw();
    }
    if (!stopped)
      timer = setTimeout(
        poll,
        doc?.widgets.some((w) => w.visible && ["chat", "alerts", "credits"].includes(w.type))
          ? 500
          : 2000,
      );
  }
  const tick = setInterval(draw, 1000);
  void poll();
  addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
    },
    { once: true },
  );
})();
