import { supportedBackgrounds, extraMotions } from "./control-deck-style-profiles.js";
/** One motion choice for the button; old combined styles remain editable. */
export function connectButtonMotion(select, background, appearance = {}, shared = false) {
  const profile = background.element.querySelector("select");
  profile.closest("label").hidden = true;
  if (shared) select.prepend(new Option("Keep current animation", "keep"));
  for (const [value, label] of [
    ["smoke", "Drifting smoke"],
    ["aurora", "Flowing aurora"],
    ["embers", "Rising embers"],
  ])
    select.add(new Option(label, value));
  const hasTexture = appearance.backgroundProfile && appearance.backgroundProfile !== "none";
  if (hasTexture && appearance.cycleColors?.length > 1) {
    select.add(new Option("Existing color cycle + texture", "combined"));
    select.value = "combined";
  } else
    select.value = shared
      ? "keep"
      : hasTexture
        ? appearance.backgroundProfile
        : appearance.cycleColors?.length > 1
          ? "cycle"
          : "static";
  const sync = () => {
    if (select.value !== "combined")
      profile.value = [
        "smoke",
        "aurora",
        "embers",
        "orbit",
        "scan",
        "ripple",
        "sparkle",
        "keep",
      ].includes(select.value)
        ? select.value
        : "none";
    background.element.hidden = ["none", "keep"].includes(profile.value);
  };
  supportedBackgrounds().then((available) => {
    for (const [key, label] of Object.entries(extraMotions))
      if (available.includes(key)) select.add(new Option(label, key));
    if (
      appearance.backgroundProfile &&
      available.includes(appearance.backgroundProfile) &&
      extraMotions[appearance.backgroundProfile]
    )
      select.value = appearance.backgroundProfile;
    sync();
  });
  select.addEventListener("input", sync);
  select.addEventListener("change", sync);
  sync();
  return { sync, cycling: () => ["cycle", "combined"].includes(select.value) };
}
let sequence = 0;
/** Preview uses the same registered color property and CSS motion as saved tiles. */
export function paintButtonCycle(preview, colors, seconds) {
  const cycling = colors.length > 1;
  preview.dataset.cycling = String(cycling);
  let style = preview.querySelector(":scope > style[data-cycle-preview]");
  if (!style) {
    style = document.createElement("style");
    style.dataset.cyclePreview = "deckPreviewCycle" + ++sequence;
    preview.append(style);
  }
  const stops = cycling ? [...colors, colors[0]] : [];
  const source = `@keyframes ${style.dataset.cyclePreview}{${stops.map((color, i) => `${(i * 100) / (stops.length - 1)}%{--deck-color:${/^#[a-f0-9]{6}$/i.test(color) ? color : "#a90036"}}`).join("")}}`;
  if (style.textContent !== source) style.textContent = source;
  preview.style.animationName = cycling ? style.dataset.cyclePreview : "none";
  preview.style.setProperty(
    "--deck-cycle-time",
    Math.min(30, Math.max(1, Number(seconds) || 12)) + "s",
  );
}
