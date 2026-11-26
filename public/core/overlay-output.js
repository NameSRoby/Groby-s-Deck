/** Saved output only. The editor's sample events and unsaved draft never reach OBS. */
/* global OverlayRenderer, OverlayModel, OverlayGameRules, createOverlayChatFeed */
(() => {
  const id = new URLSearchParams(location.search).get("id"),
    host = document.getElementById("output");
  if (!id) return;
  let doc = null,
    data = {},
    timer,
    clock,
    request,
    active = false,
    live = false,
    revision = -1,
    legacy = false;
  const chat = createOverlayChatFeed(draw);
  function fit() {
    if (!doc) return;
    const scale = Math.min(innerWidth / doc.width, innerHeight / doc.height);
    const x = (innerWidth - doc.width * scale) / 2;
    const y = (innerHeight - doc.height * scale) / 2;
    host.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
  addEventListener("resize", fit);
  function draw() {
    if (active && doc) OverlayRenderer.render(host, doc, chat.merge(data));
  }
  document.fonts?.addEventListener("loadingdone", draw);
  document.fonts?.addEventListener("loadingerror", draw);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", draw);
  async function read(signal) {
    const path = "/api/stream-overlays/",
      suffix = encodeURIComponent(id) + "?revision=" + revision,
      options = { cache: "no-store", signal };
    if (!legacy) {
      const response = await fetch(path + "presentation/" + suffix, options);
      if (response.status !== 404) return response.json();
      legacy = true;
    }
    const [library, live] = await Promise.all([
      fetch(path + "document/" + suffix, options).then((r) => r.json()),
      fetch(path + "data?fast=1", options).then((r) => r.json()),
    ]);
    return { ...library, data: live.ok ? live : undefined };
  }
  async function poll() {
    const controller = new AbortController();
    request = controller;
    try {
      const frame = await read(controller.signal);
      if (request !== controller) return;
      if (frame.ok) {
        const changed = frame.revision !== revision;
        if (changed) {
          const document = frame.document ? OverlayModel.document(frame.document) : null;
          doc = document;
          live = Boolean(doc?.widgets.some(OverlayModel.usesLiveData));
          revision = frame.revision;
          fit();
          if (!doc) host.replaceChildren();
          clearInterval(clock);
          if (doc && OverlayRenderer.needsClock(doc)) clock = setInterval(draw, 1000);
          chat.sync(
            Boolean(doc?.widgets.some((widget) => widget.visible && widget.type === "chat")),
          );
        }
        if (changed || frame.data) data = frame.data || {};
        if (changed || live) draw();
      }
    } catch {
      if (request === controller && live) draw();
    }
    if (request === controller && active)
      timer = setTimeout(poll, doc?.widgets.some(OverlayGameRules.responsive) ? 500 : 2000);
  }
  function start() {
    if (active) return;
    active = true;
    revision = -1;
    void poll();
  }
  addEventListener("pagehide", () => {
    active = false;
    request?.abort();
    request = null;
    chat.stop();
    clearTimeout(timer);
    clearInterval(clock);
  });
  addEventListener("pageshow", start);
  start();
})();
