/** Fit fader travel into the visible room, leaving space for labels and controls. */
export function fitDeckSliders(host) {
  const updates = [];
  const fullscreen = host.dataset.focus === "true";
  const navigation = host.querySelector(".deckScreenNav:not([hidden])");
  const lowerEdge = fullscreen && navigation ? navigation.getBoundingClientRect().top : innerHeight;
  const mixer =
    host.dataset.mixerPage === "true" ? host.querySelector(".deckInlineMixer:not([hidden])") : null;
  const mixerTop = mixer?.getBoundingClientRect().top;
  for (const track of host.querySelectorAll(".deckFaderTrack")) {
    const surface = track.closest("[data-slider-orientation],.deckWindowsPanel"),
      inMixer = mixer?.contains(track),
      fill = inMixer || track.closest('[data-slider-fill="true"]'),
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
      const top =
        inMixer && !fullscreen
          ? Math.max(0, Math.min(bounds.top, bounds.top - mixerTop + innerHeight * 0.35))
          : bounds.top;
      const available = Math.floor(lowerEdge - top - tail - 76);
      length =
        (inMixer
          ? Math.max(fullscreen ? 96 : 220, available)
          : Math.max(72, Math.min(720, available))) + "px";
    }
    updates.push([track, length]);
  }
  for (const [track, length] of updates) {
    if (track.style.getPropertyValue("--deck-fader-length") === length) continue;
    if (length) track.style.setProperty("--deck-fader-length", length);
    else track.style.removeProperty("--deck-fader-length");
  }
}
