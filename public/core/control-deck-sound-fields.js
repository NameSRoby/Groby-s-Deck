import { SOUNDBOARD_ERRORS } from "./soundboard-errors.js";
const requests = new WeakMap();
const base = "/api/control-deck/soundboard";
async function api(url, options) {
  const response = await fetch(url, options);
  if (response.status === 404)
    throw Error("Restart Groby's Deck to load sound-file actions in the server.");
  const result = await response.json();
  if (!response.ok || result.ok === false)
    throw Error(
      SOUNDBOARD_ERRORS[result.error] || "Could not load sounds or PC outputs. Try again.",
    );
  return result.value;
}
export function readSoundOutputs(control, validate = true) {
  const outputs = JSON.parse(control.value || "[]");
  if (!Array.isArray(outputs) || (validate && (outputs.length < 1 || outputs.length > 8)))
    throw Error("Choose between one and eight audio outputs.");
  return outputs;
}
export function renderSoundOutputs(container, control, devices) {
  const selected = new Set(JSON.parse(control.value || '["default"]'));
  const choices = [
    ["default", "Windows default output"],
    ...devices.map((row) => [row.key, row.name]),
  ];
  for (const key of selected)
    if (!choices.some(([value]) => value === key))
      choices.push([key, "Saved output is disconnected"]);
  container.replaceChildren();
  for (const [key, name] of choices) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    label.className = "deckCheck";
    input.type = "checkbox";
    input.checked = selected.has(key);
    input.onchange = () => {
      if (input.checked && selected.size >= 8) {
        input.checked = false;
        return;
      }
      if (input.checked) selected.add(key);
      else selected.delete(key);
      control.value = JSON.stringify([...selected]);
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };
    label.append(input, document.createTextNode(name));
    container.append(label);
  }
}
function populate(host, state) {
  for (const select of host.querySelectorAll('[data-soundboard-field="soundboard-clip"]')) {
    const previous = select.value;
    select.replaceChildren(...state.clips.map((row) => new Option(row.name, row.id)));
    if (previous && !state.clips.some((row) => row.id === previous))
      select.add(new Option("Saved sound is missing; choose a file", previous));
    if (previous) select.value = previous;
    else {
      select.prepend(new Option("Choose a sound or browse below", ""));
      select.value = "";
    }
  }
  for (const input of host.querySelectorAll('[data-soundboard-field="soundboard-outputs"]'))
    renderSoundOutputs(input.nextElementSibling, input, state.outputs);
}
export function attachSoundField(host, label, control, property) {
  control.dataset.soundboardField = property.format;
  const notice = document.createElement("small");
  notice.className = "deckEditorHint";
  notice.setAttribute("role", "status");
  // Opaque feature sandboxes use their admitted catalog, without direct Core HTTP access.
  if (globalThis.origin === "null") {
    if (property.format === "soundboard-outputs") {
      const choices = document.createElement("div");
      choices.className = "deckSoundOutputs";
      control.after(choices);
      renderSoundOutputs(
        choices,
        control,
        (property.items?.enum || [])
          .filter((key) => key !== "default")
          .map((key) => ({ key, name: property.enumNames?.[key] || key })),
      );
      notice.textContent = "Choose one or more outputs (up to 8).";
    } else {
      notice.textContent =
        "Choose a saved audio file. To add files, use Play sound file in the button editor.";
    }
    label.append(notice);
    return;
  }
  if (!requests.has(host))
    requests.set(
      host,
      api(base).then((state) => {
        populate(host, state);
        return state;
      }),
    );
  requests.get(host).catch((error) => {
    notice.textContent = error.message;
  });
  if (property.format === "soundboard-outputs") {
    const choices = document.createElement("div");
    choices.className = "deckSoundOutputs";
    control.after(choices);
    notice.textContent = "Choose one or more outputs (up to 8).";
    label.append(notice);
    renderSoundOutputs(choices, control, []);
    return;
  }
  const wrapper = document.createElement("div"),
    browse = document.createElement("label"),
    input = document.createElement("input");
  wrapper.className = "deckSoundFile";
  label.replaceWith(wrapper);
  wrapper.append(label, browse, notice);
  browse.className = "deckField";
  browse.append(document.createTextNode("Choose MP3 or WAV file"), input);
  input.type = "file";
  input.accept = ".mp3,.wav";
  input.setAttribute("aria-label", "Choose audio file");
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    input.dataset.soundboardUploading = "true";
    notice.textContent = "Adding sound…";
    try {
      await requests.get(host);
      if (file.size > 32 * 1024 ** 2) throw Error(SOUNDBOARD_ERRORS.soundboard_file_too_large);
      const name = file.name.replace(/\.(mp3|wav)$/i, "").slice(0, 80);
      const clip = await api(base + "/clips", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Sound-Name": encodeURIComponent(name),
        },
        body: file,
      });
      if (![...control.options].some((option) => option.value === clip.id))
        control.add(new Option(clip.name, clip.id));
      control.value = clip.id;
      control.dispatchEvent(new Event("change", { bubbles: true }));
      notice.textContent = "Ready. This file plays when the button is pressed.";
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      input.disabled = false;
      delete input.dataset.soundboardUploading;
      input.value = "";
    }
  };
}
