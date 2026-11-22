/** Fit each tile to its own size. Color/status polling never restarts display cycles. */
import { fitDeckSliders } from "./control-deck-slider-fit.js";
export function createDeckDisplay(host, paintFeedback = () => {}) {
  let frame = 0,
    feedbackFrame = 0,
    closed = false,
    measurements = new WeakMap();
  function fit() {
    frame = 0;
    const changed = [];
    // Read the whole deck before changing styles. Interleaving reads and writes
    // here forces a fresh browser layout for each tile on a crowded page.
    for (const tile of host.querySelectorAll("[data-deck-button]")) {
      const own = tile.dataset.textMode || "auto",
        global = host.dataset.display || "auto";
      const mode =
        global === "per-button" || (global === "auto" && !["auto", "image-text"].includes(own))
          ? own
          : global;
      const title = tile.querySelector(".deckButtonTitle"),
        icon = tile.querySelector(".deckButtonSymbol,.deckButtonImage"),
        slider = tile.querySelector(".deckVolumeSlider");
      const width = tile.clientWidth,
        height = tile.clientHeight;
      const key = [
        mode,
        width,
        height,
        title?.textContent,
        tile.querySelector(".deckButtonState")?.textContent,
        host.style.getPropertyValue("--deck-label-scale"),
        host.dataset.showStatus,
      ].join("|");
      if (measurements.get(tile) === key) continue;
      measurements.set(tile, key);
      changed.push({ tile, title, icon, slider, mode, width });
    }
    for (const { tile, slider, mode, width } of changed) {
      tile.dataset.compact = "false";
      tile.dataset.displayMode = mode === "auto" || slider ? "image-text" : mode;
      if (slider) {
        tile.dataset.compact = String(width < 140);
      }
    }
    const fitted = changed
      .filter(({ mode, slider, width }) => mode === "auto" && !slider && width > 0)
      .map(({ tile, title, icon, width }) => ({
        tile,
        mode:
          width < 80 && icon
            ? "image"
            : title &&
                icon &&
                (tile.scrollHeight > tile.clientHeight + 1 ||
                  title.scrollHeight > title.clientHeight + 1)
              ? "alternate"
              : !icon
                ? "text"
                : "image-text",
      }));
    for (const { tile, mode } of fitted) {
      tile.dataset.displayMode = mode;
    }
    fitDeckSliders(host);
  }
  function schedule() {
    if (!closed && !frame) frame = requestAnimationFrame(fit);
  }
  const resize = new ResizeObserver(schedule);
  resize.observe(host.querySelector(".deckGrid"));
  const changes = new MutationObserver(schedule);
  const watch = {
    attributes: true,
    attributeFilter: [
      "data-display",
      "data-slider-fill",
      "data-slider-orientation",
      "data-focus",
      "data-editing",
    ],
  };
  changes.observe(host, watch);
  host.addEventListener("groby-deck-mixer-layout", schedule);
  host.addEventListener("groby-deck-screen-change", schedule);
  window.addEventListener("resize", schedule);
  document.fonts?.ready.then(() => {
    measurements = new WeakMap();
    schedule();
  });
  return {
    schedule,
    paintButtons(buttons, paint) {
      const byId = new Map(buttons.map((button) => [button.id, button]));
      for (const tile of host.querySelectorAll("[data-deck-button]")) {
        const button = byId.get(tile.dataset.deckButton);
        if (button) paint(tile, button);
      }
    },
    scheduleFeedback() {
      if (closed || feedbackFrame) return;
      feedbackFrame = requestAnimationFrame(() => {
        feedbackFrame = 0;
        if (!closed) paintFeedback();
      });
    },
    cancelFeedback() {
      cancelAnimationFrame(feedbackFrame);
      feedbackFrame = 0;
    },
    close() {
      closed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(feedbackFrame);
      feedbackFrame = 0;
      frame = 0;
      resize.disconnect();
      changes.disconnect();
      host.removeEventListener("groby-deck-mixer-layout", schedule);
      host.removeEventListener("groby-deck-screen-change", schedule);
      window.removeEventListener("resize", schedule);
    },
    resume() {
      closed = false;
      resize.observe(host.querySelector(".deckGrid"));
      changes.observe(host, watch);
      host.addEventListener("groby-deck-mixer-layout", schedule);
      host.addEventListener("groby-deck-screen-change", schedule);
      window.addEventListener("resize", schedule);
      schedule();
    },
  };
}
