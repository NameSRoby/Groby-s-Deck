/** Derive every UI surface from the selected palette, including sandboxed pages. */
function presentationColors(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const valid = (value, fallback) =>
    typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value) ? value : fallback;
  const legacyDefault =
    input.bg === "#050507" &&
    input.surface === "#121a2f" &&
    input.accent === "#8b001f" &&
    input.text === "#eaeaea" &&
    input.glow === 65;
  const bg = valid(input.bg, "#050507"),
    surface = valid(legacyDefault ? "#19191f" : input.surface, "#19191f"),
    text = valid(input.text, "#eaeaea"),
    accent = valid(input.accent, "#8b001f");
  const channels = (color) => [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  const mix = (left, right, amount) =>
    "#" +
    channels(left)
      .map((value, index) =>
        Math.round(value * (1 - amount) + channels(right)[index] * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const panel = mix(bg, surface, 0.58);
  const glow = Number.isFinite(input.glow) ? Math.max(0, Math.min(100, input.glow)) : 65;
  const accentGlow =
    typeof input["accent-glow"] === "string" && /^#[a-f0-9]{8}$/i.test(input["accent-glow"])
      ? input["accent-glow"]
      : accent +
        Math.round(glow * 1.7)
          .toString(16)
          .padStart(2, "0");
  const luminance = channels(accent)
    .map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return {
    bg,
    panel,
    surface,
    text,
    accent,
    "accent-glow": accentGlow,
    "accent-text": luminance > 0.179 ? "#08080b" : "#ffffff",
    input: mix(bg, panel, 0.5),
    edge: mix(surface, text, 0.2),
    muted: mix(panel, text, 0.7),
    ok: valid(input.ok, "#19ff6a"),
    warn: valid(input.warn, "#ffb000"),
    bad: valid(input.bad, "#ff4444"),
  };
}
if (typeof module !== "undefined") module.exports = presentationColors;
else {
  window.GrobyPresentationColors = presentationColors;
  window.GrobyApplyTheme = (theme) => {
    for (const [key, value] of Object.entries(presentationColors(theme)))
      document.documentElement.style.setProperty("--" + key, value);
  };
  // The main HUD owns editing and persistence. Standalone tools share its saved
  // palette without applying UI colors to published overlay widget documents.
  if (!document.getElementById("themeButton")) {
    try {
      window.GrobyApplyTheme(JSON.parse(localStorage.getItem("ravelink.hud.theme")) || {});
    } catch {}
    const revision = document.documentElement.style.cssText;
    fetch("/api/presentation/theme", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (result.ok && document.documentElement.style.cssText === revision)
          window.GrobyApplyTheme(result.theme);
      })
      .catch(() => {});
    addEventListener("storage", (event) => {
      if (event.key === "ravelink.hud.theme")
        try {
          window.GrobyApplyTheme(JSON.parse(event.newValue) || {});
        } catch {}
    });
  }
}
