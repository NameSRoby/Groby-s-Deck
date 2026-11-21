/** Give the studio the entire app viewport while preserving navigation and drafts. */
(() => {
  const frame = document.getElementById("overlayDesignerFrame");
  let scroll = 0;
  const visibility = (visible) =>
    frame.contentWindow?.postMessage(
      { type: "overlay-studio-visibility", visible },
      location.origin,
    );
  const open = () => {
    scroll = window.scrollY;
    document.body.classList.add("overlayStudioOpen");
    if (!frame.src) frame.src = "/overlay-designer.html";
    else visibility(true);
  };
  frame.addEventListener("load", () =>
    visibility(document.body.classList.contains("overlayStudioOpen")),
  );
  document.querySelector('[data-tab="overlays"]')?.addEventListener("click", open);
  document.querySelectorAll('[data-tab]:not([data-tab="overlays"])').forEach((button) =>
    button.addEventListener("click", () => {
      document.body.classList.remove("overlayStudioOpen");
      visibility(false);
    }),
  );
  addEventListener("message", (event) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== location.origin ||
      event.data?.type !== "overlay-studio-exit"
    )
      return;
    document.body.classList.remove("overlayStudioOpen");
    document.querySelector('[data-tab="dashboard"]')?.click();
    window.scrollTo(0, scroll);
  });
})();
