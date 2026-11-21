import { supportedBackgrounds, extraMotions } from "./control-deck-style-profiles.js";
/** Local CSS atmospheres animate transforms/opacity, never the button's action/status. */
const observed = new Set(),
  controls = new WeakMap();
let pruning = false;
function pruneLater() {
  if (pruning) return;
  pruning = true;
  queueMicrotask(() => {
    pruning = false;
    for (const tile of observed)
      if (!tile.isConnected) {
        visibility.unobserve(tile);
        observed.delete(tile);
      }
  });
}
const visibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries)
    target.dataset.backgroundVisible = String(isIntersecting);
});
document.addEventListener("visibilitychange", () => {
  document.documentElement.dataset.deckHidden = String(document.hidden);
});
function pauseControl(host) {
  if (!host || controls.has(host)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "deckMotionPause";
  let paused = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.dataset.deckMotionAllowed = String(
    localStorage.getItem("ravelink.deck.motion") === "allowed",
  );
  button.onclick = () => {
    if (reduced && document.documentElement.dataset.deckMotionAllowed !== "true") {
      localStorage.setItem("ravelink.deck.motion", "allowed");
      document.documentElement.dataset.deckMotionAllowed = "true";
      button.textContent = "Pause effects";
      return;
    }
    paused = !paused;
    host.dataset.motionPaused = String(paused);
    button.textContent = paused ? "Resume effects" : "Pause effects";
    button.setAttribute("aria-pressed", String(paused));
  };
  button.textContent =
    reduced && document.documentElement.dataset.deckMotionAllowed !== "true"
      ? "Enable motion (reduced motion is on)"
      : "Pause effects";
  button.setAttribute("aria-label", "Pause button backgrounds");
  button.setAttribute("aria-pressed", "false");
  const move = () =>
    (
      host.querySelector(host.dataset.focus === "true" ? ".deckFullscreenBar" : ".deckTools") ||
      host
    ).append(button);
  const observer = new MutationObserver(move);
  observer.observe(host, { attributes: true, attributeFilter: ["data-focus"] });
  controls.set(host, button);
  move();
}
export function installBackgroundControls(host) {
  for (const tile of observed)
    if (!tile.isConnected) {
      visibility.unobserve(tile);
      observed.delete(tile);
    }
  if (host.querySelector(".deckButtonAtmosphere, [data-cycling=true]")) pauseControl(host);
}
export function paintButtonBackground(tile, appearance = {}) {
  pruneLater();
  const profile = appearance.backgroundProfile || "none";
  tile.dataset.backgroundProfile = profile;
  tile.style.setProperty(
    "--deck-atmosphere-duration",
    24 - (appearance.backgroundSpeed || 40) * 0.2 + "s",
  );
  tile.style.setProperty("--deck-atmosphere-strength", (appearance.backgroundStrength || 45) / 100);
  let layer = tile.querySelector(":scope > .deckButtonAtmosphere");
  if (profile === "none") {
    layer?.remove();
    visibility.unobserve(tile);
    observed.delete(tile);
    return;
  }
  if (!layer) {
    layer = document.createElement("span");
    layer.className = "deckButtonAtmosphere";
    layer.setAttribute("aria-hidden", "true");
    tile.prepend(layer);
  }
  if (!observed.has(tile)) {
    observed.add(tile);
    visibility.observe(tile);
  }
  pauseControl(tile.closest(".controlDeck"));
}
export function createBackgroundEditor(parent, value = {}, shared = false) {
  const group = document.createElement("div");
  group.className = "deckBackgroundFields";
  group.innerHTML =
    '<label class="deckField">Button background<select id="deckBackgroundProfile"><option value="none">None</option><option value="smoke">Smoke</option><option value="aurora">Aurora</option><option value="embers">Embers</option></select></label><label class="deckField">Animation speed<input id="deckBackgroundSpeed" type="range" min="1" max="100"></label><label class="deckField">Background strength<input id="deckBackgroundStrength" type="range" min="1" max="100"></label>';
  const profile = group.querySelector("select"),
    speed = group.querySelector("#deckBackgroundSpeed"),
    strength = group.querySelector("#deckBackgroundStrength");
  if (shared) {
    profile.prepend(new Option("Keep current backgrounds", "keep"));
    for (const input of group.querySelectorAll("[id]"))
      input.id = input.id.replace("deckBackground", "deckSharedBackground");
  }
  profile.value = value.backgroundProfile || (shared ? "keep" : "none");
  supportedBackgrounds().then((available) => {
    for (const [key, label] of Object.entries(extraMotions))
      if (available.includes(key)) profile.add(new Option(label, key));
    if (value.backgroundProfile && available.includes(value.backgroundProfile))
      profile.value = value.backgroundProfile;
  });
  speed.value = value.backgroundSpeed || 40;
  strength.value = value.backgroundStrength || 45;
  for (const input of [speed, strength]) {
    const output = document.createElement("output");
    input.after(output);
    const update = () => (output.textContent = input.value + "%");
    input.addEventListener("input", update);
    update();
  }
  parent.append(group);
  return {
    element: group,
    sync: () => {
      for (const input of [speed, strength])
        input.nextElementSibling.textContent = input.value + "%";
    },
    read: () => ({
      backgroundProfile: profile.value,
      backgroundSpeed: Number(speed.value),
      backgroundStrength: Number(strength.value),
    }),
  };
}
