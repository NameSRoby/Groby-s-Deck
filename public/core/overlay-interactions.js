/** Pointer coordinates are converted from preview pixels to document pixels. */
/* exported setupOverlayInteractions */
/* global setupOverlayGuides, OverlayRenderer, OverlayTextStyle */
globalThis.setupOverlayInteractions = function (a) {
  const canvas = a.$("canvas");
  const guides = setupOverlayGuides(a);
  let gesture = null,
    marquee = null,
    motionFrame = null,
    pendingMove = null;
  const box = document.createElement("div");
  box.className = "marqueeSelection";
  box.hidden = true;
  document.body.append(box);
  const menu = document.createElement("div");
  menu.id = "canvasMenu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  for (const [id, title] of [
    ["copySelection", "Copy"],
    ["pasteSelection", "Paste"],
    ["duplicate", "Duplicate"],
    ["group", "Group selection"],
    ["ungroup", "Ungroup"],
    ["bringToFront", "Bring to front"],
    ["sendToBack", "Send to back"],
    ["lockSelection", "Lock / unlock"],
    ["showSelection", "Show / hide"],
    ["remove", "Delete"],
  ]) {
    const button = document.createElement("button");
    button.textContent = title;
    button.dataset.action = id;
    button.setAttribute("role", "menuitem");
    button.onclick = () => {
      menu.hidePopover();
      a.$(id).click();
    };
    menu.append(button);
  }
  canvas.addEventListener("contextmenu", (event) => {
    if (a.previewing) return;
    event.preventDefault();
    const layer = event.target.closest("[data-widget-id]");
    if (layer && !a.selection.has(layer.dataset.widgetId)) a.select(layer.dataset.widgetId, false);
    for (const button of menu.querySelectorAll("button"))
      button.disabled = a.$(button.dataset.action).disabled;
    menu.showPopover();
    menu.style.left =
      Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, event.clientX)) + "px";
    menu.style.top =
      Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, event.clientY)) + "px";
  });
  a.$("stageWrap").addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || a.previewing) return;
      event.preventDefault();
      const choices = [0.25, 0.5, 0.75, 1, 1.5],
        current = a.scale(),
        next =
          event.deltaY < 0
            ? choices.find((n) => n > current + 0.01)
            : choices.toReversed().find((n) => n < current - 0.01);
      if (next) {
        const before = canvas.getBoundingClientRect(),
          x = (event.clientX - before.left) / current,
          y = (event.clientY - before.top) / current;
        a.$("zoom").value = String(next);
        a.$("zoom").dispatchEvent(new Event("change"));
        const after = canvas.getBoundingClientRect(),
          wrap = a.$("stageWrap");
        wrap.scrollLeft += after.left + x * a.scale() - event.clientX;
        wrap.scrollTop += after.top + y * a.scale() - event.clientY;
      }
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (event) => {
    if (a.previewing || event.button !== 0 || gesture || marquee) return;
    const layer = event.target.closest("[data-widget-id]");
    if (!layer) {
      marquee = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        prior: event.shiftKey ? [...a.selection] : [],
      };
      if (!event.shiftKey) a.selection.clear();
      a.draw();
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      canvas.focus();
      return;
    }
    const widgetId = layer.dataset.widgetId;
    const multi = event.shiftKey || event.ctrlKey || event.metaKey;
    const tile = !multi && Number(event.target.closest("[data-board-tile]")?.dataset.boardTile);
    if (!a.selection.has(widgetId) || multi) a.select(widgetId, multi);
    if (!a.selection.has(layer.dataset.widgetId)) return;
    a.showSelection?.();
    const selected = a.selected().filter((row) => !row.locked);
    if (!selected.length && !tile) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tile,
      widgetId,
      corner: event.target.dataset.corner,
      rows: selected.map((row) => ({ ...row })),
      alignment: guides.capture(selected),
    };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    canvas.focus();
  });
  function updatePointer(event) {
    if (marquee && event.pointerId === marquee.id) {
      const left = Math.min(event.clientX, marquee.x),
        top = Math.min(event.clientY, marquee.y),
        width = Math.abs(event.clientX - marquee.x),
        height = Math.abs(event.clientY - marquee.y);
      Object.assign(box.style, {
        left: left + "px",
        top: top + "px",
        width: width + "px",
        height: height + "px",
      });
      box.hidden = false;
      a.selection.clear();
      for (const id of marquee.prior) a.selection.add(id);
      for (const row of a.doc.widgets) {
        if (row.locked || !row.visible) continue;
        const rect = canvas
          .querySelector('[data-widget-id="' + CSS.escape(row.id) + '"]')
          ?.getBoundingClientRect();
        if (
          rect &&
          rect.right >= left &&
          rect.left <= left + width &&
          rect.bottom >= top &&
          rect.top <= top + height
        )
          a.selection.add(row.id);
      }
      a.renderSelection();
      return;
    }
    if (!gesture || event.pointerId !== gesture.id) return;
    if (
      gesture.tile &&
      !gesture.changed &&
      (!gesture.rows.length || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4)
    )
      return;
    const scale = a.scale(),
      dx = (event.clientX - gesture.x) / scale,
      dy = (event.clientY - gesture.y) / scale;
    const snap = (value) =>
      a.$("snap").checked && !event.altKey ? Math.round(value / 10) * 10 : Math.round(value);
    const bound = (v, min, max) => Math.max(min, Math.min(max, v));
    if (!gesture.changed && Math.abs(dx) + Math.abs(dy) < 1) return;
    if (!gesture.changed) {
      gesture.priorRedo = a.checkpoint();
      gesture.changed = true;
    }
    const [moveX, moveY] = gesture.corner
      ? [0, 0]
      : guides.move(gesture.alignment, [dx, dy], event.altKey);
    for (const start of gesture.rows) {
      const row = a.doc.widgets.find((w) => w.id === start.id);
      if (gesture.corner) {
        const west = gesture.corner.includes("w"),
          north = gesture.corner.includes("n");
        const maxWidth = west ? start.x + start.width : a.doc.width - start.x;
        const maxHeight = north ? start.y + start.height : a.doc.height - start.y;
        row.width =
          gesture.corner === "n" || gesture.corner === "s"
            ? start.width
            : bound(snap(start.width + (west ? -dx : dx)), 20, maxWidth);
        row.height =
          gesture.corner === "e" || gesture.corner === "w"
            ? start.height
            : bound(snap(start.height + (north ? -dy : dy)), 20, maxHeight);
        if (start.lockRatio || event.shiftKey) {
          const factor =
            gesture.corner === "n" || gesture.corner === "s"
              ? row.height / start.height
              : row.width / start.width;
          const limited = Math.min(factor, maxWidth / start.width, maxHeight / start.height);
          row.width = start.width * limited;
          row.height = start.height * limited;
        }
        row.x = west
          ? bound(start.x + start.width - row.width, 0, a.doc.width - row.width)
          : start.x;
        row.y = north
          ? bound(start.y + start.height - row.height, 0, a.doc.height - row.height)
          : start.y;
      } else {
        row.x = start.x + moveX;
        row.y = start.y + moveY;
      }
      const layer = canvas.querySelector('[data-widget-id="' + CSS.escape(row.id) + '"]');
      if (layer && OverlayRenderer.place(layer, row)) OverlayTextStyle.fit(layer, row);
    }
  }
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== (gesture || marquee)?.id) return;
    pendingMove = event;
    if (motionFrame) return;
    motionFrame = requestAnimationFrame(() => {
      motionFrame = null;
      const latest = pendingMove;
      pendingMove = null;
      if (latest) updatePointer(latest);
    });
  });
  function end(cancel = false) {
    cancelAnimationFrame(motionFrame);
    motionFrame = null;
    const latest = pendingMove;
    pendingMove = null;
    if (!cancel && latest) updatePointer(latest);
    guides.clear();
    if (marquee) {
      const current = marquee;
      marquee = null;
      box.hidden = true;
      if (cancel) {
        a.selection.clear();
        for (const id of current.prior) a.selection.add(id);
      }
      if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id);
      if (a.selection.size) a.showSelection?.();
      a.draw();
      return;
    }
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    if (cancel && current.changed) {
      for (const row of current.rows)
        Object.assign(
          a.doc.widgets.find((w) => w.id === row.id),
          row,
        );
      a.cancelCheckpoint(current.priorRedo);
    }
    if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id);
    if (!cancel && !current.changed && current.tile)
      a.selectBoardTile(current.widgetId, current.tile);
    else a.draw();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === (gesture || marquee)?.id) end(type === "pointercancel");
    });
  document.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (event.key === "Escape" && (gesture || marquee)) {
      event.preventDefault();
      end(true);
      return;
    }
    if (command && event.key.toLowerCase() === "s" && !event.target.closest("dialog")) {
      event.preventDefault();
      a.$("save").click();
      return;
    }
    if (event.target.closest("input,textarea,select,dialog") || a.previewing) return;
    const key = event.key.toLowerCase();
    if (event.altKey && ["x", "f"].includes(key)) {
      event.preventDefault();
      a.$("zoom").value = key === "x" ? "1" : "fit";
      a.$("zoom").dispatchEvent(new Event("change"));
      return;
    }
    if (!command && event.shiftKey && ["d", "g", "u"].includes(key)) {
      event.preventDefault();
      a.$({ d: "duplicate", g: "group", u: "ungroup" }[key]).click();
      return;
    }
    if (command && ["a", "c", "x", "v"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      if (key === "a") a.commands.selectAll();
      else if (key === "v") a.commands.paste();
      else a.commands.copy(key === "x");
      return;
    }
    if (command && event.key.toLowerCase() === "g") {
      event.preventDefault();
      a.$(event.shiftKey ? "ungroup" : "group").click();
      return;
    }
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      a.history(event.shiftKey ? 1 : -1);
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      a.history(1);
      return;
    }
    if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      a.$("save").click();
      return;
    }
    if (command && event.key.toLowerCase() === "d") {
      event.preventDefault();
      a.$("duplicate").click();
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      a.commands.rename();
      return;
    }
    if (event.key === "Escape") {
      a.selection.clear();
      a.draw();
      return;
    }
    if (["Delete", "Backspace"].includes(event.key) && a.selected().length) {
      event.preventDefault();
      a.$("remove").click();
      return;
    }
    const vector = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ];
    if (!vector || !a.selected().length) return;
    event.preventDefault();
    a.change(() => {
      for (const row of a.selected().filter((w) => !w.locked)) {
        row.x = Math.max(
          0,
          Math.min(a.doc.width - row.width, row.x + vector[0] * (event.shiftKey ? 10 : 1)),
        );
        row.y = Math.max(
          0,
          Math.min(a.doc.height - row.height, row.y + vector[1] * (event.shiftKey ? 10 : 1)),
        );
      }
    });
  });
};
