/** Native dialogs follow the visible part of a tall, possibly sandboxed iframe. */
export function createVisibleDialog(dialog, { maxWidth = 480 } = {}) {
  let generation = 0,
    opener = null,
    intersection = null,
    resize = null,
    updating = false,
    queued = false;
  dialog.classList.add("visibleDialog");
  function visibleArea() {
    return new Promise((resolve) => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect();
        resolve(entry.intersectionRect);
      });
      observer.observe(document.body);
    });
  }
  function position(area) {
    if (area.width <= 0 || area.height <= 0) return false;
    dialog.style.left = area.left + area.width / 2 + "px";
    dialog.style.top = area.top + area.height / 2 + "px";
    dialog.style.width = Math.min(maxWidth, Math.max(0, area.width - 32)) + "px";
    dialog.style.maxHeight = Math.max(0, area.height - 32) + "px";
    return true;
  }
  async function update() {
    if (!dialog.open) return;
    if (updating) {
      queued = true;
      return;
    }
    updating = true;
    const token = generation,
      area = await visibleArea();
    updating = false;
    if (token === generation && dialog.open && !position(area)) dialog.close();
    if (queued) {
      queued = false;
      void update();
    }
  }
  function stop() {
    generation++;
    queued = false;
    intersection?.disconnect();
    resize?.disconnect();
    window.removeEventListener("resize", update);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  dialog.addEventListener("close", stop);
  window.addEventListener("pagehide", () => {
    if (dialog.open) dialog.close();
  });
  return {
    async open() {
      const token = ++generation;
      opener = document.activeElement;
      const area = await visibleArea();
      if (token !== generation || !position(area)) return false;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector("[autofocus]")?.focus({ preventScroll: true });
      intersection?.disconnect();
      resize?.disconnect();
      intersection = new IntersectionObserver(update, { threshold: [0, 1] });
      intersection.observe(dialog);
      resize = new ResizeObserver(update);
      resize.observe(dialog);
      window.addEventListener("resize", update);
      return true;
    },
  };
}
