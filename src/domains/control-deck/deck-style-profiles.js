/** Appearance-only profiles. Recovery snapshots never contain actions or artwork. */
const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store"),
  { fault } = require("./control-deck-config"),
  { randomUUID } = require("node:crypto"),
  path = require("node:path");
const keys = [
  "color",
  "textColor",
  "backlight",
  "profileBacklight",
  "cycleColors",
  "cycleMs",
  "backgroundProfile",
  "backgroundSpeed",
  "backgroundStrength",
];
module.exports = (runtimeDir) => {
  const file = path.join(runtimeDir, "system", "deck-style-profiles.json");
  let state = readJsonFile(file, { revision: 0, profiles: [] });
  if (!Number.isSafeInteger(state?.revision) || !Array.isArray(state.profiles))
    state = { revision: 0, profiles: [] };
  const capture = (config) =>
    config.pages.flatMap((page) =>
      page.buttons.map((button) => ({
        id: button.id,
        appearance: {
          backgroundProfile: "none",
          backgroundSpeed: 40,
          backgroundStrength: 45,
          ...Object.fromEntries(
            keys
              .filter((key) => button.appearance[key] !== undefined)
              .map((key) => [key, structuredClone(button.appearance[key])]),
          ),
        },
      })),
    );
  const list = () => ({
    revision: state.revision,
    profiles: state.profiles.map(({ id, name, automatic, at }) => ({ id, name, automatic, at })),
    backgroundProfiles: ["smoke", "aurora", "embers", "orbit", "scan", "ripple", "sparkle"],
  });
  function commit(profiles) {
    if (JSON.stringify(profiles).length > 2000000) throw fault("control_deck_style_profiles_full");
    const next = { revision: state.revision + 1, profiles };
    writeJsonFile(file, next);
    state = next;
    return list();
  }
  function backup(config) {
    const buttons = capture(config);
    if (
      state.profiles.some(
        (p) => p.automatic && JSON.stringify(p.buttons) === JSON.stringify(buttons),
      )
    )
      return;
    const row = {
      id: randomUUID(),
      name: "Before style change",
      automatic: true,
      at: Date.now(),
      buttons,
    };
    commit([
      ...state.profiles.filter((p) => !p.automatic),
      ...state.profiles.filter((p) => p.automatic).slice(-4),
      row,
    ]);
  }
  function save(input, config) {
    if (input.profileRevision !== state.revision) throw fault("control_deck_revision_conflict");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 60) throw fault("control_deck_style_profile_name_invalid");
    if (state.profiles.some((p) => !p.automatic && p.name.toLowerCase() === name.toLowerCase()))
      throw fault("control_deck_style_profile_name_exists");
    if (state.profiles.filter((p) => !p.automatic).length >= 20)
      throw fault("control_deck_style_profiles_full");
    return commit([
      ...state.profiles,
      { id: randomUUID(), name, automatic: false, at: Date.now(), buttons: capture(config) },
    ]);
  }
  function apply(input, config) {
    if (input.profileRevision !== state.revision) throw fault("control_deck_revision_conflict");
    const profile = state.profiles.find((p) => p.id === input.id);
    if (!profile) throw fault("control_deck_style_profile_missing");
    const next = structuredClone(config),
      styles = new Map(profile.buttons.map((row) => [row.id, row.appearance]));
    let matched = 0;
    for (const page of next.pages)
      for (const button of page.buttons) {
        const value = styles.get(button.id);
        if (value) {
          matched++;
          for (const key of keys)
            if (value[key] !== undefined) button.appearance[key] = structuredClone(value[key]);
        }
      }
    if (!matched) throw fault("control_deck_style_profile_no_matches");
    return next;
  }
  function remove(input) {
    if (input.profileRevision !== state.revision) throw fault("control_deck_revision_conflict");
    return commit(state.profiles.filter((p) => p.id !== input.id));
  }
  return { list, save, apply, remove, backup, capture };
};
