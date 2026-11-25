/** Shared targets only: never bind the maintainer's fixture IDs or network data. */
module.exports = [
  ["streaming", "Streaming", true, 75, "color", "#9b4dff", 3500],
  ["mood", "Mood", true, 35, "color", "#287fbb", 3500],
  ["warm", "Warm studio", true, 70, "temperature", "#ffffff", 3200],
  ["focus", "Focus", true, 85, "temperature", "#ffffff", 5000],
  ["ocean", "Ocean lights", true, 65, "color", "#1bb3cf", 3500],
  ["sunset", "Sunset", true, 50, "color", "#f1773d", 3500],
  ["off", "Off", false, 1, "color", "#ffffff", 3500],
].map(([key, name, on, brightness, mode, color, temperatureKelvin]) => ({
  id: "public-" + key,
  name,
  isDefault: false,
  strategy: "shared",
  fixtureTargets: {},
  sharedTarget: { on, brightness, mode, color, temperatureKelvin },
  public: true,
}));
