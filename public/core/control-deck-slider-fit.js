/** Fit fader travel into the visible room, leaving space for labels and controls. */
export function fitDeckSliders(host) {
  const updates = [];
  const footer =
    host.querySelector(".deckFullscreenBar:not([hidden])")?.getBoundingClientRect().height || 0;
  for (const track of host.querySelectorAll(".deckFaderTrack")) {
    const surface = track.closest("[data-slider-orientation],.deckWindowsPanel"),
      fill = track.closest('[data-slider-fill="true"]'),
      vertical =
        (surface?.dataset.sliderOrientation || surface?.dataset.orientation) === "vertical";
    let length = "";
    if (fill && vertical && track.getClientRects().length) {
      const card = track.closest(".deckButton,.deckWindowsAudioCard"),
        bounds = track.getBoundingClientRect(),
        style = card && getComputedStyle(card);
      // A mixer row stretches its cards to the tallest channel. Reserve the
      // controls below this track, rather than that unused stretched space.
      let bottom = bounds.bottom;
      for (let sibling = track.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (sibling.getClientRects().length)
          bottom = Math.max(bottom, sibling.getBoundingClientRect().bottom);
      }
      const tail = bottom - bounds.bottom + (parseFloat(style?.paddingBottom) || 0);
      length =
        Math.max(72, Math.min(720, Math.floor(innerHeight - bounds.top - tail - footer - 88))) +
        "px";
    }
    updates.push([track, length]);
  }
  for (const [track, length] of updates) {
    if (track.style.getPropertyValue("--deck-fader-length") === length) continue;
    if (length) track.style.setProperty("--deck-fader-length", length);
    else track.style.removeProperty("--deck-fader-length");
  }
}
