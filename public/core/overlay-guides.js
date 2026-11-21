/** Snap moving selections to the canvas and other visible layers. */
globalThis.setupOverlayGuides = (a) => {
  const frame = a.$("stageFrame"),
    lines = ["vertical", "horizontal"].map((direction) => {
      const line = document.createElement("div");
      line.className = "overlayAlignGuide " + direction;
      return line;
    }),
    safe = document.createElement("div");
  safe.className = "overlaySafeMargins";
  for (const element of [...lines, safe]) {
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    frame.append(element);
  }
  const anchors = (start, end) => [start, (start + end) / 2, end];
  const capture = (rows) => {
    const ids = new Set(rows.map((row) => row.id)),
      others = a.doc.widgets.filter((row) => row.visible && !ids.has(row.id));
    return [
      ["x", "width"],
      ["y", "height"],
    ].map(([axis, size]) => {
      const extent = a.doc[size],
        first = Math.min(...rows.map((row) => row[axis])),
        last = Math.max(...rows.map((row) => row[axis] + row[size])),
        targets = anchors(0, extent);
      for (const row of others) targets.push(...anchors(row[axis], row[axis] + row[size]));
      if (a.$("safeMargins").checked) targets.push(extent * 0.05, extent * 0.95);
      return { extent, anchors: anchors(first, last), targets, first, last };
    });
  };
  function move(layout, deltas, bypass) {
    return layout.map(({ extent, anchors, targets, first, last }, index) => {
      const delta = deltas[index],
        line = lines[index],
        bound = (value) => Math.max(-first, Math.min(extent - last, value));
      let target,
        closest = 6 / a.scale(),
        result = bypass || !a.$("snap").checked ? Math.round(delta) : Math.round(delta / 10) * 10;
      if (!bypass && a.$("alignmentGuides").checked)
        for (const next of targets)
          for (const origin of anchors) {
            const offset = next - origin,
              distance = Math.abs(offset - delta);
            if (distance <= closest && bound(offset) === offset) {
              result = offset;
              closest = distance;
              target = next;
            }
          }
      line.hidden = target === undefined;
      if (target !== undefined) line.style[index ? "top" : "left"] = (100 * target) / extent + "%";
      return bound(result);
    });
  }
  a.$("safeMargins").onchange = () => {
    safe.hidden = !a.$("safeMargins").checked;
  };
  return {
    capture,
    move,
    clear: () =>
      lines.forEach((line) => {
        line.hidden = true;
      }),
  };
};
