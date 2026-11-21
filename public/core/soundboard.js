import { renderSoundOutputs, readSoundOutputs } from "./control-deck-sound-fields.js";
import { SOUNDBOARD_ERRORS } from "./soundboard-errors.js";
import "./browser-random-id.js";
/** Library management creates ordinary deck macros, never special-case buttons. */
(() => {
  const panel = document.querySelector('[data-panel="soundboard"]');
  const byId = (id) => document.getElementById(id),
    base = "/api/control-deck/soundboard";
  const notice = byId("soundboardNotice");
  let clips = [],
    busy = false;
  const messages = SOUNDBOARD_ERRORS;
  async function api(url, options) {
    const response = await fetch(url, options);
    if (response.status === 404)
      throw Error(
        "Soundboard is not available in the running server yet. Restart Groby's Deck to load the update.",
      );
    const result = await response.json();
    if (!response.ok || result.ok === false)
      throw Error(
        messages[result.error] || "Could not complete this change. Refresh and try again.",
      );
    return result.value;
  }
  const json = (method, value) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  function params(clip) {
    return {
      clip,
      outputs: readSoundOutputs(byId("soundboardOutput")),
      volume: Number(byId("soundboardVolume").value),
      mode: byId("soundboardMode").value,
    };
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    panel.setAttribute("aria-busy", "true");
    panel.querySelectorAll("button,input,select").forEach((control) => {
      control.disabled = true;
    });
    try {
      await work();
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      busy = false;
      panel.removeAttribute("aria-busy");
      panel.querySelectorAll("button,input,select").forEach((control) => {
        control.disabled = false;
      });
    }
  }
  async function addButton(clip) {
    const deck = await api("/api/control-deck"),
      config = deck.config;
    let page = config.pages.find((row) => row.id === byId("soundboardPage").value);
    if (!page) {
      page = { id: "soundboard-" + globalThis.GrobyRandomId(), name: "Soundboard", buttons: [] };
      config.pages.push(page);
    }
    page.buttons.push({
      id: "sound-" + globalThis.GrobyRandomId(),
      title: clip.name,
      kind: "macro",
      steps: [{ actionId: "native.soundboard.play", params: params(clip.id), delayMs: 0 }],
      appearance: { symbol: "♪" },
    });
    await api("/api/control-deck", json("PUT", { revision: deck.revision, value: config }));
    notice.textContent = `Added ${clip.name} to ${page.name}. Edit its actions, timing or keyboard shortcut in Button deck.`;
    await pages();
    byId("soundboardPage").value = page.id;
  }
  async function pages() {
    const deck = await api("/api/control-deck"),
      select = byId("soundboardPage"),
      previous = select.value;
    select.replaceChildren(new Option("New Soundboard page", ""));
    for (const page of deck.config.pages) select.add(new Option(page.name, page.id));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  function draw() {
    const body = byId("soundboardRows");
    body.replaceChildren();
    if (!clips.length) {
      const row = body.insertRow();
      row.insertCell().textContent = "Add WAV or MP3 sounds to begin.";
      return;
    }
    for (const clip of clips) {
      const row = body.insertRow();
      row.insertCell().textContent = clip.name;
      row.insertCell().textContent = (clip.bytes / 1024 ** 2).toFixed(1) + " MiB";
      const actions = row.insertCell();
      actions.className = "actions";
      for (const [label, work] of [
        [
          "Play",
          async () => {
            await api(base + "/play", json("POST", params(clip.id)));
            notice.textContent = `Playing ${clip.name} on the host PC.`;
          },
        ],
        ["Stop", () => api(base + "/stop", json("POST", { clip: clip.id }))],
        ["Add deck button", () => addButton(clip)],
        [
          "Rename",
          async () => {
            const dialog = byId("soundboardRename"),
              field = byId("soundboardName");
            field.value = clip.name;
            dialog.showModal();
            field.focus();
            byId("soundboardRenameSave").onclick = () => {
              if (!field.reportValidity()) return;
              dialog.close();
              void run(async () => {
                await api(base + "/clips/" + clip.id, json("PATCH", { name: field.value }));
                await refresh();
              });
            };
          },
        ],
        [
          "Remove",
          async () => {
            const dialog = byId("soundboardRemove");
            byId("soundboardRemoveName").textContent = clip.name;
            dialog.showModal();
            byId("soundboardRemoveConfirm").onclick = () => {
              dialog.close();
              void run(async () => {
                await api(base + "/clips/" + clip.id, { method: "DELETE" });
                await refresh();
                notice.textContent =
                  "Sound removed. Existing buttons can be edited to choose another sound.";
              });
            };
          },
        ],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.onclick = () => void run(work);
        actions.append(button);
      }
    }
  }
  async function refresh() {
    const state = await api(base);
    renderSoundOutputs(byId("soundboardOutputChoices"), byId("soundboardOutput"), state.outputs);
    if (state.error)
      notice.textContent =
        messages[state.error] ||
        "An audio output stopped responding. Check its connection and try again.";
    clips = state.clips;
    draw();
    await pages();
    byId("soundboardStatus").textContent = state.available
      ? `${clips.length} sounds · ${(clips.reduce((sum, row) => sum + row.bytes, 0) / 1024 ** 2).toFixed(1)} / 1024 MiB`
      : "Windows playback unavailable. Refresh to retry.";
  }
  byId("soundboardUpload").onchange = () =>
    void run(async () => {
      const input = byId("soundboardUpload");
      for (const file of [...input.files].slice(0, 20)) {
        if (file.size > 32 * 1024 ** 2) throw Error(messages.soundboard_file_too_large);
        const name = file.name.replace(/\.(wav|mp3)$/i, "").slice(0, 80);
        // ASCII header; encode names containing accents without changing the display label.
        await api(base + "/clips", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Sound-Name": encodeURIComponent(name),
          },
          body: file,
        });
      }
      input.value = "";
      await refresh();
      notice.textContent = "Sounds added. Choose an output and add deck buttons.";
    });
  byId("soundboardRefresh").onclick = () => void run(refresh);
  byId("soundboardStop").onclick = () =>
    void run(async () => {
      await api(base + "/stop", json("POST", {}));
      notice.textContent = "All soundboard sounds stopped.";
    });
  byId("soundboardRenameCancel").onclick = () => byId("soundboardRename").close();
  byId("soundboardRemoveCancel").onclick = () => byId("soundboardRemove").close();
  let loaded = false;
  new MutationObserver(() => {
    if (!panel.hidden && !loaded) {
      loaded = true;
      void run(refresh);
    }
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
})();
