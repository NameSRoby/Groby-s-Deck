/** Periods are rolling windows. Current subscribers have no historical start date. */
globalThis.renderOverlayCredits = (w, data, now) => {
  const viewport = document.createElement("div"),
    track = document.createElement("div");
  viewport.className = "creditsViewport";
  track.className = "creditsTrack";
  viewport.dataset.direction = w.scrollDirection;
  viewport.style.setProperty("--credit-seconds", w.scrollSeconds + "s");
  viewport.style.setProperty("--credit-width", w.width + "px");
  viewport.style.setProperty("--credit-height", w.height + "px");
  viewport.style.setProperty("--credit-gap", w.creditGap + "px");
  viewport.dataset.reverse = String(w.scrollReverse);
  viewport.dataset.paused = String(w.scrollPaused);
  let names = w.items || [];
  const credits = data.twitch?.credits,
    source = credits?.[w.creditsSource];
  if (w.creditsSource !== "manual") {
    const days = { day: 1, week: 7, month: 30, year: 365 }[w.creditsPeriod],
      cutoff = days ? now - days * 86400000 : 0;
    const rows =
      w.creditsSource === "subscribers" && days
        ? (credits?.history || []).filter(
            (row) =>
              row.kind === "subscribers" &&
              source?.names?.some(
                (current) => current.name.toLowerCase() === row.name.toLowerCase(),
              ),
          )
        : source?.names || [];
    names = rows.filter((row) => !days || (row.at && row.at >= cutoff)).map((row) => row.name);
  }
  names = [...new Set(names)].slice(0, 1000);
  for (let copy = 0; copy < 2; copy++) {
    const group = document.createElement("div");
    group.className = "creditsGroup";
    if (copy) group.setAttribute("aria-hidden", "true");
    for (const name of names) {
      const item = document.createElement("div");
      item.textContent = name;
      group.append(item);
      if (w.creditSeparator) {
        const separator = document.createElement("span");
        separator.className = "creditSeparator";
        separator.textContent = w.creditSeparator;
        separator.setAttribute("aria-hidden", "true");
        group.append(separator);
      }
    }
    track.append(group);
  }
  viewport.append(track);
  const wrap = document.createElement("div");
  wrap.className = "creditsWidget";
  if (w.label) {
    const heading = document.createElement("strong");
    heading.className = "creditsHeading";
    heading.textContent = w.label;
    wrap.append(heading);
  }
  wrap.append(viewport);
  return wrap;
};
