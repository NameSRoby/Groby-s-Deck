/** Optional local-device feedback for touch interaction in the fullscreen deck. */
export function createDeckHaptics({ host, getConfig, save, explain }) {
  const supported = typeof navigator.vibrate === "function";
  const section = document.createElement("section");
  section.className = "deckHapticsSettings";
  section.setAttribute("aria-label", "Fullscreen touch feedback");
  section.innerHTML =
    '<label><input id="deckHapticsEnabled" type="checkbox"> Fullscreen touch feedback</label><label for="deckHapticsSensitivity">Sensitivity <output></output><input id="deckHapticsSensitivity" type="range" min="1" max="100" value="50"></label><p></p>';
  host.querySelector(".deckToolbar").after(section);
  const toggle = section.querySelector('[type="checkbox"]'),
    sensitivity = section.querySelector('[type="range"]'),
    output = section.querySelector("output"),
    help = section.querySelector("p");
  let touch = false,
    gesture = null,
    lastPulse = -Infinity,
    saving = false,
    used = false;
  const levels = new WeakMap();
  function settings() {
    try {
      return getConfig()?.layout || {};
    } catch {
      return {};
    }
  }
  function sync() {
    if (saving) return;
    const layout = settings();
    toggle.checked = layout.hapticsEnabled === true;
    sensitivity.value = layout.hapticsSensitivity || 50;
    output.textContent = sensitivity.value + "%";
    toggle.disabled = sensitivity.disabled = !supported;
    help.textContent = supported
      ? "Only while using the fullscreen deck. Higher sensitivity gives more frequent slider ticks. Device settings control vibration strength."
      : "This browser does not offer vibration feedback. Controls still work normally.";
  }
  async function persist() {
    if (saving) return;
    const config = structuredClone(getConfig());
    config.layout.hapticsEnabled = toggle.checked;
    config.layout.hapticsSensitivity = Number(sensitivity.value);
    saving = true;
    toggle.disabled = sensitivity.disabled = true;
    let failure = "";
    try {
      await save(config);
    } catch (error) {
      failure = explain(error);
    } finally {
      saving = false;
      sync();
      if (failure) help.textContent = failure;
    }
  }
  toggle.addEventListener("change", persist);
  sensitivity.addEventListener("input", () => {
    output.textContent = sensitivity.value + "%";
  });
  sensitivity.addEventListener("change", persist);
  function pulse(duration, rate = 90) {
    if (
      !supported ||
      !touch ||
      document.hidden ||
      host.dataset.focus !== "true" ||
      host.dataset.editing === "true" ||
      !settings().hapticsEnabled ||
      performance.now() - lastPulse < rate
    )
      return;
    try {
      if (navigator.vibrate(duration)) {
        used = true;
        lastPulse = performance.now();
      }
    } catch {
      /* Unsupported hardware must never interrupt a control. */
    }
  }
  host.addEventListener(
    "pointerdown",
    (event) => {
      touch = event.pointerType === "touch";
      gesture = touch
        ? {
            x: event.clientX,
            y: event.clientY,
            moved: false,
            step: !!event.target.closest(".deckSliderStep"),
          }
        : null;
      const input = event.target.closest(".deckFaderTrack")?.querySelector('input[type="range"]');
      if (input) levels.set(input, Number(input.value));
    },
    true,
  );
  host.addEventListener(
    "pointermove",
    (event) => {
      if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12)
        gesture.moved = true;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      touch = false;
    },
    true,
  );
  host.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("button,[data-deck-button]");
      if (
        !event.isTrusted ||
        gesture?.moved ||
        !button ||
        button.disabled ||
        button.closest(".deckHapticsSettings,.deckFaderTrack") ||
        event.target.closest("input,output,.deckSliderExact")
      )
        return;
      pulse(12);
    },
    true,
  );
  host.addEventListener("ravelink-slider-change", (event) => {
    const input = event.target,
      value = event.detail.value;
    if (gesture?.step && !gesture.stepped) {
      gesture.stepped = true;
      pulse(6);
      levels.set(input, value);
      return;
    }
    const sensitivity = settings().hapticsSensitivity || 50,
      spacing = Math.max(2, Math.round(12 - sensitivity / 10)),
      previous = levels.get(input) ?? event.detail.previous;
    if (!levels.has(input)) levels.set(input, previous);
    const boundary = value === Number(input.min) || value === Number(input.max);
    if (boundary || Math.abs(value - previous) >= spacing) {
      pulse(boundary ? 16 : 6, Math.round(360 - sensitivity * 2.7));
      levels.set(input, value);
    }
  });
  const cancel = () => {
    if (used && supported) {
      try {
        navigator.vibrate(0);
      } catch {}
    }
    used = touch = false;
  };
  const observer = new MutationObserver(() => {
    sync();
    if (
      host.dataset.focus !== "true" ||
      host.dataset.editing === "true" ||
      !settings().hapticsEnabled
    )
      cancel();
  });
  observer.observe(host, { attributes: true, attributeFilter: ["data-editing", "data-focus"] });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel();
  });
  window.addEventListener("pagehide", cancel);
  sync();
}
