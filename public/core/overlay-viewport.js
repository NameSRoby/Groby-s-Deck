/** A hand tool pans the preview, never the document or its undo history. */
globalThis.setupOverlayViewport = (a) => {
  const wrap = a.$("stageWrap"),
    button = a.$("panCanvas");
  let toggled = false,
    space = false,
    drag;
  const sync = () => {
    button.setAttribute("aria-pressed", String(toggled));
    wrap.classList.toggle("handReady", toggled || space);
  };
  button.onclick = () => {
    toggled = !toggled;
    sync();
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.code !== "Space" ||
      event.target.closest("input,textarea,select,button,dialog") ||
      a.previewing
    )
      return;
    event.preventDefault();
    space = true;
    sync();
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      space = false;
      sync();
    }
  });
  addEventListener("blur", () => {
    space = false;
    drag = null;
    wrap.classList.remove("handDragging");
    sync();
  });
  wrap.addEventListener(
    "pointerdown",
    (event) => {
      if (a.previewing || !(event.button === 1 || (event.button === 0 && (space || toggled))))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: wrap.scrollLeft,
        top: wrap.scrollTop,
      };
      wrap.setPointerCapture(event.pointerId);
      wrap.classList.add("handDragging");
    },
    true,
  );
  wrap.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      wrap.scrollLeft = drag.left + drag.x - event.clientX;
      wrap.scrollTop = drag.top + drag.y - event.clientY;
    },
    true,
  );
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = drag.id;
    drag = null;
    wrap.classList.remove("handDragging");
    if (wrap.hasPointerCapture(id)) wrap.releasePointerCapture(id);
  };
  wrap.addEventListener("pointerup", end, true);
  wrap.addEventListener("pointercancel", end, true);
};
