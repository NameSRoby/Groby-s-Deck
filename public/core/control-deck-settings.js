import { installSoundboardShortcut } from "./control-deck-soundboard.js";
import { createStyleProfiles } from "./control-deck-style-profiles.js";
import { connectButtonMotion, paintButtonCycle } from "./control-deck-motion.js";
/** Bulk styling changes only appearance; actions and uploaded artwork are retained. */
import { createDeckHaptics } from "./control-deck-haptics.js";
import { createBackgroundEditor, paintButtonBackground } from "./control-deck-backgrounds.js";
const presets = {
  crimson: { color: "#e43662", cycleColors: [], backlight: 65 },
  ice: { color: "#63d9ff", cycleColors: [], backlight: 60 },
  ember: { color: "#ffa34f", cycleColors: [], backlight: 55 },
  aurora: { color: "#51ddb0", cycleColors: ["#51ddb0", "#648aff", "#c57cff"], backlight: 65 },
  off: { color: "#8994ab", cycleColors: [], backlight: 0 },
};
export function createDeckSettings({
  host,
  getConfig,
  getPageId,
  save,
  editor,
  explain,
  refreshDeck,
}) {
  installSoundboardShortcut(host);
  createDeckHaptics({ host, getConfig, save, explain });
  const dialog = document.createElement("dialog");
  dialog.id = "deckSettings";
  dialog.className = "deckEditor deckSettings";
  dialog.setAttribute("aria-labelledby", "deckSettingsTitle");
  dialog.innerHTML =
    '<div class="deckEditorHeading"><h2 id="deckSettingsTitle">Button settings</h2><button type="button" id="deckSettingsClose" aria-label="Close button settings">×</button></div><nav class="deckSettingsTabs" aria-label="Button settings"><button type="button" id="deckStyleTab">Style & presets</button><button type="button" id="deckButtonsTab">Individual buttons</button></nav><section id="deckSharedStyle"><p class="deckEditorHint">Animations keep existing colors by default. Choose a color preset or change the color control only when you want to recolor buttons.</p><div class="deckAppearanceFields"><label class="deckField">Apply to<select id="deckStyleScope"></select></label><label class="deckField">Preset<select id="deckStylePreset"><option value="keep">Keep existing button colors</option><option value="crimson">Crimson glow</option><option value="ice">Ice blue</option><option value="ember">Warm amber</option><option value="aurora">Aurora color cycle</option><option value="off">Backlight off</option><option value="custom">Custom style</option></select></label><label class="deckField">Backlight color<input id="deckStyleColor" type="color" value="#e43662"></label><label class="deckField">Button animation<select id="deckStyleEffect"><option value="static">Steady light</option><option value="cycle">Slow color cycle</option></select></label><label class="deckField">Backlight brightness (0 = off)<input id="deckStyleBacklight" type="range" min="0" max="100" step="1" value="65"><output id="deckStyleLevel">65%</output></label><label class="deckField">Cycle duration (seconds)<input id="deckStyleSeconds" type="number" min="1" max="30" value="12"></label></div><div class="deckCycleFields" id="deckStyleCycle"><label class="deckField">Cycle color 1<input type="color" value="#51ddb0"></label><label class="deckField">Cycle color 2<input type="color" value="#648aff"></label><label class="deckField">Cycle color 3<input type="color" value="#c57cff"></label></div><div class="deckAppearancePreview" aria-label="Shared style preview"><span class="deckLedSource" aria-hidden="true"></span><span class="deckAcrylicFace" aria-hidden="true"></span><span>✦</span><strong>Preview</strong></div><div class="deckEditorActions"><button type="button" id="deckApplyStyle" disabled>Apply style</button></div></section><section id="deckIndividualButtons" hidden><p class="deckEditorHint">Choose a button to edit its action, picture or animated GIF, icon, text, colors and effects. Auto fits the content; Alternate switches between its icon and text periodically. In Deck layout, choose Use each button’s setting to apply individual display choices. Use Edit on the deck to drag buttons into order.</p><div class="deckSettingsButtonList"></div><button type="button" id="deckSettingsAdd">+ Add a button</button></section><p class="deckEditorNotice" role="status" aria-live="polite"></p>';
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector("#deck" + id),
    preview = dialog.querySelector(".deckAppearancePreview"),
    notice = dialog.querySelector(".deckEditorNotice");
  const styleProfiles = createStyleProfiles({ dialog, refreshDeck, notice });
  let busy = false,
    brightnessChanged = false;
  preview.classList.add("deckButton");
  const background = createBackgroundEditor(
    dialog.querySelector(".deckAppearanceFields"),
    {},
    true,
  );
  const motion = connectButtonMotion($("StyleEffect"), background, {}, true);
  background.element.addEventListener("input", () => redraw());
  function tab(individual) {
    $("SharedStyle").hidden = individual;
    $("IndividualButtons").hidden = !individual;
    $("StyleTab").setAttribute("aria-pressed", String(!individual));
    $("ButtonsTab").setAttribute("aria-pressed", String(individual));
  }
  $("StyleTab").onclick = () => tab(false);
  $("ButtonsTab").onclick = () => tab(true);
  $("SettingsClose").onclick = () => {
    if (!busy) dialog.close();
  };
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  function redraw(custom = false) {
    if (custom) $("StylePreset").value = "custom";
    const cycle = motion.cycling(),
      keep = $("StylePreset").value === "keep";
    $("StyleCycle").hidden = !cycle;
    $("StyleSeconds").disabled = !cycle;
    $("StyleLevel").textContent = $("StyleBacklight").value + "%";
    preview.style.setProperty("--deck-color", $("StyleColor").value);
    preview.style.setProperty("--deck-backlight", Number($("StyleBacklight").value) / 100);
    preview.hidden = keep;
    motion.sync();
    paintButtonCycle(
      preview,
      cycle ? Array.from($("StyleCycle").querySelectorAll("input"), (input) => input.value) : [],
      $("StyleSeconds").value,
    );
    const atmosphere = background.read();
    preview.hidden = keep && atmosphere.backgroundProfile === "keep";
    paintButtonBackground(preview, atmosphere.backgroundProfile === "keep" ? {} : atmosphere);
    $("ApplyStyle").disabled =
      busy || (keep && $("StyleEffect").value === "keep" && !brightnessChanged);
  }
  $("StylePreset").onchange = () => {
    const preset = presets[$("StylePreset").value];
    if (preset) {
      $("StyleColor").value = preset.color;
      $("StyleBacklight").value = preset.backlight;
      $("StyleEffect").value = preset.cycleColors.length ? "cycle" : "static";
      $("StyleSeconds").value = 12;
      if (preset.cycleColors.length)
        $("StyleCycle")
          .querySelectorAll("input")
          .forEach((input, i) => (input.value = preset.cycleColors[i]));
    }
    redraw();
  };
  for (const input of [
    $("StyleColor"),
    $("StyleEffect"),
    $("StyleBacklight"),
    $("StyleSeconds"),
    ...$("StyleCycle").querySelectorAll("input"),
  ])
    input.addEventListener("input", () => {
      if (input === $("StyleBacklight")) brightnessChanged = true;
      redraw(input === $("StyleColor"));
    });
  $("ApplyStyle").onclick = async () => {
    const seconds = Number($("StyleSeconds").value);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) {
      notice.textContent = "Choose a cycle duration from 1 to 30 seconds.";
      return;
    }
    const config = structuredClone(getConfig()),
      scope = $("StyleScope").value;
    const appearance =
      $("StylePreset").value === "keep"
        ? {}
        : {
            profileBacklight: "custom",
            color: $("StyleColor").value,
            backlight: Number($("StyleBacklight").value),
          };
    if (brightnessChanged)
      Object.assign(appearance, {
        backlight: Number($("StyleBacklight").value),
        profileBacklight: "custom",
      });
    if (["static", "cycle"].includes($("StyleEffect").value))
      Object.assign(appearance, {
        cycleColors: motion.cycling()
          ? Array.from($("StyleCycle").querySelectorAll("input"), (input) => input.value)
          : [],
        cycleMs: Math.round(seconds * 1000),
      });
    if (background.read().backgroundProfile !== "keep")
      Object.assign(appearance, background.read());
    for (const page of config.pages)
      for (const button of page.buttons)
        if (
          scope === "all" ||
          (scope === "page" && page.id === getPageId()) ||
          scope === "button:" + button.id
        )
          button.appearance = {
            ...button.appearance,
            ...appearance,
            ...(button.kind === "slider" ? { backgroundProfile: "none" } : {}),
          };
    busy = true;
    redraw();
    notice.textContent = "Saving style…";
    try {
      await save(config);
      void styleProfiles.refresh();
      notice.textContent =
        "Style saved. Actions and artwork are unchanged. Undo is available on the deck.";
    } catch (error) {
      notice.textContent = explain(error);
    } finally {
      busy = false;
      redraw();
    }
  };
  $("SettingsAdd").onclick = () => {
    dialog.close();
    editor.button(null, getPageId());
  };
  return {
    open() {
      brightnessChanged = false;
      void styleProfiles.refresh();
      const config = getConfig(),
        scope = $("StyleScope");
      scope.replaceChildren(new Option("All buttons", "all"), new Option("Current page", "page"));
      const list = dialog.querySelector(".deckSettingsButtonList");
      list.replaceChildren();
      for (const page of config.pages)
        for (const button of page.buttons) {
          scope.add(new Option(page.name + " · " + button.title, "button:" + button.id));
          const edit = document.createElement("button");
          edit.type = "button";
          edit.textContent = (button.appearance.symbol || "✦") + " " + button.title;
          edit.onclick = () => {
            dialog.close();
            editor.button(button, page.id);
          };
          list.append(edit);
        }
      const selected = config.pages
        .flatMap((page) => page.buttons)
        .filter((button) => button.kind !== "slider");
      const first = selected[0]?.appearance || {};
      $("StylePreset").value = "keep";
      $("StyleEffect").value =
        selected.length &&
        selected.every((button) =>
          [
            "backgroundProfile",
            "backgroundSpeed",
            "backgroundStrength",
            "cycleMs",
            "cycleColors",
          ].every((key) => JSON.stringify(button.appearance[key]) === JSON.stringify(first[key])),
        )
          ? first.backgroundProfile && first.backgroundProfile !== "none"
            ? first.backgroundProfile
            : first.cycleColors?.length > 1
              ? "cycle"
              : "static"
          : "keep";
      $("StyleColor").value = first.color || "#e43662";
      $("StyleBacklight").value = first.backlight ?? 65;
      $("StyleSeconds").value = (first.cycleMs || 12000) / 1000;
      if (first.cycleColors?.length)
        $("StyleCycle")
          .querySelectorAll("input")
          .forEach(
            (input, index) => (input.value = first.cycleColors[index] || first.color || "#e43662"),
          );
      background.element.querySelector('input[id$="Speed"]').value = first.backgroundSpeed ?? 40;
      background.element.querySelector('input[id$="Strength"]').value =
        first.backgroundStrength ?? 45;

      background.sync();
      motion.sync();
      notice.textContent = "";
      tab(false);
      redraw();
      dialog.showModal();
    },
  };
}
