/** A hand tool pans the preview, never the document or its undo history. */
function setupSidebarResize(a) {
  const divider = a.$("sidebarResize"),
    sidebar = a.$("layersPanel"),
    workspace = divider.parentElement;
  const preference = "groby.overlay.sidebarWidth";
  const minimum = 220;
  const maximum = () => Math.min(760, Math.floor(innerWidth * 0.58));
  let drag;
  function sync() {
    if (!sidebar.offsetWidth) return;
    divider.setAttribute("aria-valuemin", String(minimum));
    divider.setAttribute("aria-valuemax", String(maximum()));
    divider.setAttribute("aria-valuenow", String(sidebar.offsetWidth));
    divider.setAttribute("aria-valuetext", sidebar.offsetWidth + " pixels");
  }
  function resize(pixels) {
    const width = Math.max(minimum, Math.min(maximum(), Math.round(pixels)));
    workspace.style.setProperty("--sidebar-width", width + "px");
    sync();
  }
  function save() {
    const width = parseInt(workspace.style.getPropertyValue("--sidebar-width"), 10);
    try {
      if (width) localStorage.setItem(preference, String(width));
      else localStorage.removeItem(preference);
    } catch {
      // The current viewport still supports resizing when storage is unavailable.
    }
  }
  try {
    const width = Number(localStorage.getItem(preference));
    if (Number.isFinite(width) && width >= minimum)
      workspace.style.setProperty("--sidebar-width", width + "px");
  } catch {
    // Use the responsive default.
  }
  new ResizeObserver(sync).observe(sidebar);
  addEventListener("resize", sync);
  divider.onpointerdown = (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = {
      id: event.pointerId,
      start: event.clientX,
      width: sidebar.offsetWidth,
      previous: workspace.style.getPropertyValue("--sidebar-width"),
    };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add("resizingSidebar");
  };
  divider.onpointermove = (event) => {
    if (event.pointerId === drag?.id) resize(drag.width + event.clientX - drag.start);
  };
  function end(event) {
    if (event.pointerId !== drag?.id) return;
    if (event.type === "pointerup" && event.clientX !== drag.start) {
      resize(drag.width + event.clientX - drag.start);
      save();
    } else {
      workspace.style.setProperty("--sidebar-width", drag.previous);
      sync();
    }
    drag = null;
    workspace.classList.remove("resizingSidebar");
  }
  divider.onpointerup = divider.onpointercancel = divider.onlostpointercapture = end;
  divider.ondblclick = () => {
    workspace.style.removeProperty("--sidebar-width");
    sync();
    save();
  };
  divider.onkeydown = (event) => {
    const width = {
      ArrowLeft: sidebar.offsetWidth - 16,
      ArrowRight: sidebar.offsetWidth + 16,
      Home: minimum,
      End: maximum(),
    }[event.key];
    if (width === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    resize(width);
    save();
  };
}

globalThis.setupOverlayViewport = (a) => {
  setupSidebarResize(a);
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
