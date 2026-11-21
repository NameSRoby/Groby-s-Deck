/** Canvas move, resize and crop gestures share one immutable undo baseline. */
/* global config, selectedPreviewPiece, selectedShapeId, canvasGesture, canvasGuides, canvasSnap, OverlayDesignerEditing, enableCanvas, canvasTarget, updatePieceInspector, bounded, resizeCanvasTarget, renderPreview, sync, focusCanvasTarget, $ */
/* exported startCanvasGesture, selectedPreviewPiece, selectedShapeId, canvasGesture */
function startCanvasGesture(event, firstMove = null) {
  if (event.button !== 0) return;
  const segmentLabel = event.target.closest("[data-select-segment]");
  if (segmentLabel) {
    event.preventDefault();
    return;
  }
  const handle = event.target.closest("[data-corner]"),
    b = event.target.closest("[data-block-id]"),
    s = event.target.closest("[data-segment-id]");
  if (!handle) {
    selectedPreviewPiece = event.altKey ? "" : b?.dataset.blockId || "";
    selectedShapeId = s?.dataset.segmentId || "";
  }
  if (!handle && !s) return;
  // A click still opens typography controls without converting a flow preset.
  // Only an actual drag commits its measured geometry to the canvas model.
  if (config.layoutMode !== "canvas" && b && !event.altKey) {
    const clear = () => {
      window.removeEventListener("pointermove", beginDrag);
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
    const beginDrag = (move) => {
      if (Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < 3) return;
      clear();
      OverlayDesignerEditing.begin();
      enableCanvas();
      startCanvasGesture(event, move);
    };
    window.addEventListener("pointermove", beginDrag);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return;
  }
  OverlayDesignerEditing.begin();
  enableCanvas();
  const target = canvasTarget();
  if (!target?.frame) {
    OverlayDesignerEditing.finish(true);
    return;
  }
  event.preventDefault();
  updatePieceInspector();
  const baseline = structuredClone(target),
    start = { ...target.frame },
    stage = $("preview"),
    ratio = stage.getBoundingClientRect().width / stage.offsetWidth,
    px = event.clientX,
    py = event.clientY,
    corner = handle?.dataset.corner;
  canvasGesture = true;
  const move = (e) => {
    const dx = Math.round((e.clientX - px) / ratio),
      dy = Math.round((e.clientY - py) / ratio);
    const f = target.frame;
    if (corner && e.altKey) {
      const crop = (target.crop = { top: 0, right: 0, bottom: 0, left: 0, ...baseline.crop });
      if (corner.includes("w"))
        crop.left = bounded(crop.left + dx, 0, start.width - crop.right - 1);
      if (corner.includes("e"))
        crop.right = bounded(crop.right - dx, 0, start.width - crop.left - 1);
      if (corner.includes("n"))
        crop.top = bounded(crop.top + dy, 0, start.height - crop.bottom - 1);
      if (corner.includes("s"))
        crop.bottom = bounded(crop.bottom - dy, 0, start.height - crop.top - 1);
      renderPreview();
      return;
    }
    if (!corner) {
      f.x = bounded(start.x + dx, 0, 960);
      f.y = bounded(start.y + dy, 0, 600);
    } else if (!target.lockSize) {
      const west = corner.includes("w"),
        north = corner.includes("n");
      f.width =
        corner === "n" || corner === "s"
          ? start.width
          : bounded(start.width + (west ? -dx : dx), 1, 960);
      f.height =
        corner === "e" || corner === "w"
          ? start.height
          : bounded(start.height + (north ? -dy : dy), 1, 600);
      if (target.lockRatio || e.shiftKey) {
        // Use the dominant pointer axis so vertical and horizontal drags both
        // work. Snapping is skipped for locked resize to preserve the ratio.
        const factor =
          Math.abs(dx / start.width) >= Math.abs(dy / start.height)
            ? f.width / start.width
            : f.height / start.height;
        f.width = bounded(start.width * factor, 1, 960);
        f.height = bounded(start.height * factor, 1, 600);
      }
      resizeCanvasTarget(target, { ...f }, baseline);
      if (west) f.x = bounded(start.x + start.width - f.width, 0, 960);
      if (north) f.y = bounded(start.y + start.height - f.height, 0, 600);
    }
    canvasGuides = [];
    if (canvasSnap && !e.altKey && !(corner && (target.lockRatio || e.shiftKey)))
      snapCanvasFrame(target, corner, 6 / ratio);
    if (corner && !target.lockSize && !target.lockRatio && !e.shiftKey)
      resizeCanvasTarget(target, { ...f }, baseline);
    config.preset = "custom";
    renderPreview();
  };
  const end = (event) => {
    canvasGuides = [];
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("keydown", cancel);
    OverlayDesignerEditing.finish(event?.type === "pointercancel" || event?.key === "Escape");
    sync();
    focusCanvasTarget();
    setTimeout(() => (canvasGesture = null), 0);
  };
  const cancel = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      end(event);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("keydown", cancel);
  if (firstMove) move(firstMove);
}
function snapCanvasFrame(target, corner, tolerance) {
  const row = config.segments.find((s) => s.blocks.includes(target)),
    parent = row?.frame || config;
  const ox = row?.frame?.x || 0,
    oy = row?.frame?.y || 0;
  const siblings = (row ? row.blocks : config.segments).filter(
    (s) => s !== target && s.enabled !== false && s.frame,
  );
  const f = target.frame;
  for (const axis of ["x", "y"]) {
    if (corner && !(axis === "x" ? /[we]/ : /[ns]/).test(corner)) continue;
    const size = axis === "x" ? "width" : "height",
      limit = parent[size],
      origin = axis === "x" ? ox : oy;
    const lines = [
      0,
      limit / 2,
      limit,
      ...siblings.flatMap((s) => [
        s.frame[axis],
        s.frame[axis] + s.frame[size] / 2,
        s.frame[axis] + s.frame[size],
      ]),
    ];
    const offsets = corner
      ? [corner.includes(axis === "x" ? "w" : "n") ? 0 : f[size]]
      : [0, f[size] / 2, f[size]];
    let best = null;
    for (const line of lines)
      for (const offset of offsets) {
        const distance = line - (f[axis] + offset);
        if (
          Math.abs(distance) <= tolerance &&
          (!best || Math.abs(distance) < Math.abs(best.distance))
        )
          best = { distance, line, offset };
      }
    if (!best) continue;
    if (!corner) f[axis] = bounded(f[axis] + best.distance, 0, axis === "x" ? 960 : 600);
    else if (best.offset === 0) {
      const end = f[axis] + f[size];
      f[axis] = bounded(f[axis] + best.distance, 0, axis === "x" ? 960 : 600);
      f[size] = Math.max(1, end - f[axis]);
    } else f[size] = bounded(f[size] + best.distance, 1, axis === "x" ? 960 : 600);
    canvasGuides.push({
      axis,
      value: origin + best.line,
      start: axis === "x" ? oy : ox,
      length: axis === "x" ? parent.height : parent.width,
    });
  }
}
