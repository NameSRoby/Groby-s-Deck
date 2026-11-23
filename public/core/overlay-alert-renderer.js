/** Alert media belongs to an event instance; live ticks never restart its playback. */
(function (root) {
  const playing = new WeakMap();
  const report = (node, message) =>
    node.dispatchEvent(new CustomEvent("overlay-media-error", { bubbles: true, detail: message }));
  function stop(node) {
    const prior = playing.get(node);
    prior?.audio?.pause();
    for (const video of node.querySelectorAll("video")) video.pause();
    playing.delete(node);
  }
  function content(widget, row) {
    const body = document.createElement("div");
    body.className = "alertBody";
    if (!row) return body;
    const selected = root.OverlayAlertRules.select(widget, row);
    const card = document.createElement("div");
    card.className = "alertCard overlayItem";
    card.dataset.itemKey = row.id;
    card.dataset.layout = selected.layout;
    if (selected.mediaUrl && selected.layout !== "text") {
      const video =
        selected.mediaType === "video" ||
        (selected.mediaType === "auto" && /\.(mp4|webm)(?:[?#]|$)/i.test(selected.mediaUrl));
      const media = document.createElement(video ? "video" : "img");
      media.className = "alertMedia";
      media.src = selected.mediaUrl;
      media.style.objectFit = selected.mediaFit;
      if (video) {
        media.autoplay = true;
        media.playsInline = true;
        media.muted = selected.mediaMuted;
        media.volume = selected.volume / 100;
      } else media.alt = "";
      media.addEventListener(
        "error",
        () => {
          report(
            media,
            "The alert media could not be loaded. Check the URL or upload the file again.",
          );
          media.remove();
        },
        { once: true },
      );
      card.append(media);
    }
    const words = document.createElement("span");
    words.className = "itemText alertText";
    words.style.setProperty("--text-delay", selected.textDelay + "s");
    words.style.animationDelay =
      Math.min(selected.textDelay, Math.max(0, selected.lifetime - 0.1)) + "s";
    words.textContent = root.OverlayAlertRules.message(selected.text, row);
    card.append(words);
    body.append(card);
    return body;
  }
  function sync(node, widget, row, audioEnabled) {
    const key = row ? row.id : "";
    const prior = playing.get(node);
    const selected = row && root.OverlayAlertRules.select(widget, row);
    for (const video of node.querySelectorAll("video")) {
      video.muted = !audioEnabled || selected?.mediaMuted !== false;
      video.volume = (selected?.volume ?? 70) / 100;
    }
    if (prior?.audio && selected) prior.audio.volume = selected.volume / 100;
    if (prior?.key === key) return;
    // Stop only the previous detached sound. The current video is already in the DOM.
    prior?.audio?.pause();
    const state = { key, audio: null };
    playing.set(node, state);
    for (const video of node.querySelectorAll("video")) {
      if (video.closest("[data-leaving]")) {
        video.pause();
        continue;
      }
      if (!audioEnabled) video.muted = true;
      void video.play().catch(() => {
        node.dataset.mediaBlocked = "true";
        report(
          node,
          "Video playback was blocked. Test the alert again after clicking in this page.",
        );
      });
    }
    if (audioEnabled && selected?.soundUrl) {
      state.audio = new Audio(selected.soundUrl);
      state.audio.volume = selected.volume / 100;
      void state.audio.play().catch(() => {
        node.dataset.audioBlocked = "true";
        report(
          node,
          "Alert sound could not play. Check the file and test again after clicking in this page.",
        );
      });
    }
  }
  root.OverlayAlertRenderer = { content, sync, stop };
  addEventListener("pagehide", () => {
    for (const node of document.querySelectorAll('[data-widget-type="alerts"]')) stop(node);
  });
})(globalThis);
