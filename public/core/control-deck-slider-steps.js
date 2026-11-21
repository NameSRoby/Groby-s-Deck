/** Large precision controls: tap once or hold to repeat. No timers survive release. */
export function createSliderSteps({ input, adjust, finish }) {
  const track = input.closest(".deckFaderTrack");
  if (!track) return { cancel() {}, close() {} };
  let timer,
    suppressClick = false,
    held = null,
    pointer = null;
  const buttons = [];
  function stop() {
    clearTimeout(timer);
    timer = null;
    if (!held) return;
    held = null;
    pointer = null;
    finish();
  }
  function repeat(direction) {
    if (!held || input.disabled || document.hidden || !input.getClientRects().length) return stop();
    adjust(direction);
    timer = setTimeout(() => repeat(direction), 160);
  }
  for (const [direction, label, symbol] of [
    [1, "Increase", "+"],
    [-1, "Decrease", "−"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = input.disabled;
    button.className = "deckSliderStep";
    button.dataset.direction = String(direction);
    button.textContent = symbol;
    button.setAttribute("aria-label", `${label} ${input.getAttribute("aria-label") || "volume"}`);
    button.title = `${label} · hold for slow adjustment`;
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.button !== 0 || input.disabled || held) return;
      event.preventDefault();
      suppressClick = true;
      held = button;
      pointer = event.pointerId;
      button.setPointerCapture?.(pointer);
      adjust(direction);
      timer = setTimeout(() => repeat(direction), 400);
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      // Pointer presses already applied on pointerdown; keyboard activation has detail 0.
      if (event.detail === 0 && !input.disabled) {
        adjust(direction);
        finish();
      }
    });
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (["Enter", " "].includes(event.key)) suppressClick = false;
    });
    button.addEventListener("lostpointercapture", stop);
    buttons.push(button);
    if (direction === 1) track.prepend(button);
    else track.append(button);
  }
  const release = (event) => {
    if (event.type === "pointercancel") suppressClick = false;
    if (event.pointerId === pointer) stop();
  };
  const observer = new MutationObserver(() => {
    buttons.forEach((button) => {
      button.disabled = input.disabled;
    });
    if (input.disabled) stop();
  });
  observer.observe(input, { attributes: true, attributeFilter: ["disabled"] });
  const hide = () => {
    if (document.hidden) stop();
  };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", hide);
  return {
    cancel: stop,
    close() {
      stop();
      observer.disconnect();
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hide);
      buttons.forEach((button) => button.remove());
    },
  };
}
