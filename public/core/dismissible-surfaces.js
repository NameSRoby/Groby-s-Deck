/** Consistent light dismissal, including clicks across sandboxed feature frames.
 * Cancel events retain ownership of unsaved-work prompts and never submit forms. */
function installDismissibleSurfaces() {
  const channel = "groby-dismiss-surfaces-v1";
  let outside = null;
  const frames = () => [...document.querySelectorAll("iframe")];
  const broadcast = (source) => {
    for (const frame of frames())
      if (frame.contentWindow !== source)
        frame.contentWindow?.postMessage({ channel, type: "outside" }, "*");
  };
  const closeDialog = (dialog) => {
    if (typeof dialog.requestClose === "function") dialog.requestClose();
    else if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
  };
  const floating = (target) => {
    for (const panel of document.querySelectorAll("[data-dismiss-surface]")) {
      const toggle = document.getElementById(panel.dataset.dismissToggle || "");
      if (!panel.hidden && !panel.contains(target) && !toggle?.contains(target))
        panel.hidden = true;
    }
    for (const menu of document.querySelectorAll(
      "details.moreNav[open],details.overlayLibrary[open]",
    ))
      if (!menu.contains(target)) menu.open = false;
    for (const popover of document.querySelectorAll("[popover]"))
      if (
        typeof popover.hidePopover === "function" &&
        popover.matches(":popover-open") &&
        !popover.contains(target)
      )
        popover.hidePopover();
  };
  const dialogs = () => document.querySelectorAll("dialog[open]");
  const backdrop = (event) => {
    const dialog = event.target;
    if (dialog?.tagName !== "DIALOG" || !dialog.open) return null;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
      ? dialog
      : null;
  };
  document.addEventListener(
    "pointerdown",
    (event) => {
      outside = backdrop(event);
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (outside && outside === backdrop(event)) closeDialog(outside);
      outside = null;
      floating(event.target);
      broadcast();
      if (parent !== window) parent.postMessage({ channel, type: "pointer" }, "*");
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    () => {
      outside = null;
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialogs().length) floating(document.body);
  });
  addEventListener("message", (event) => {
    if (event.data?.channel !== channel) return;
    if (event.source === parent && parent !== window && event.data.type === "outside") {
      const open = [...dialogs()].at(-1);
      if (open) closeDialog(open);
      floating(document.body);
      broadcast();
    } else if (
      event.data.type === "pointer" &&
      frames().some((frame) => frame.contentWindow === event.source)
    ) {
      floating(document.body);
      broadcast(event.source);
      if (parent !== window) parent.postMessage({ channel, type: "pointer" }, "*");
    }
  });
}
if (typeof module !== "undefined") module.exports = installDismissibleSurfaces;
else installDismissibleSurfaces();
