/** Shared Core style library; no browser-only profiles or hidden recoloring. */
export const extraMotions = {
  orbit: "Orbiting rings",
  scan: "Scanner sweep",
  ripple: "Ripple rings",
  sparkle: "Starfield shimmer",
};
let supported;
export function supportedBackgrounds() {
  return (supported ||= fetch("/api/control-deck/style-profiles", { cache: "no-store" })
    .then(async (r) => (r.ok ? (await r.json()).value.backgroundProfiles : []))
    .catch(() => []));
}
export function createStyleProfiles({ dialog, refreshDeck, notice }) {
  const section = document.createElement("details");
  section.className = "deckStyleProfiles";
  section.innerHTML =
    '<summary>Saved style profiles & recovery</summary><p>Save the current colors and animations for each button. Restoring a profile keeps actions, labels and artwork.</p><label class="deckField">Profile<select></select></label><label class="deckField">New profile name<input maxlength="60" placeholder="For example: Stream colors"></label><div class="deckEditorActions"><button type="button" data-profile="save">Save current style</button><button type="button" data-profile="restore">Restore selected</button><button type="button" data-profile="delete">Delete selected profile</button></div><p role="status"></p>';
  dialog.querySelector("#deckSharedStyle").append(section);
  const picker = section.querySelector("select"),
    name = section.querySelector("input"),
    status = section.querySelector('[role="status"]');
  section.querySelector("summary").after(status);
  let state = { revision: 0, profiles: [] };
  const messages = {
    control_deck_style_profile_name_exists:
      "A profile with that name already exists. Choose a new name.",
    control_deck_style_profiles_full:
      "The style profile library is full. Remove an unused profile first.",
    control_deck_style_profile_name_invalid: "Enter a profile name of up to 60 characters.",
    control_deck_revision_conflict: "The deck or profile library changed. Refresh and try again.",
    control_deck_style_profile_no_matches:
      "This profile has no matching buttons in the current deck.",
    control_deck_style_profile_missing: "That profile is no longer available.",
  };
  async function request(method = "GET", path = "", payload) {
    const response = await fetch("/api/control-deck/style-profiles" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store",
    });
    if (response.status === 404)
      throw Error(
        "Restart Core to enable saved style profiles and automatic recovery snapshots. Animation-only changes already preserve colors.",
      );
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Error(
        messages[result.error] || "Could not update the style profiles. Refresh and try again.",
      );
    return result.value;
  }
  async function refresh() {
    picker.disabled = true;
    section.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      state = await request();
      picker.disabled = false;
      name.disabled = false;
      const prior = picker.value;
      picker.replaceChildren(
        new Option("Choose a saved style", ""),
        ...state.profiles.map(
          (p) =>
            new Option(p.name + (p.automatic ? " - " + new Date(p.at).toLocaleString() : ""), p.id),
        ),
      );
      picker.value = prior;
      status.textContent =
        "Before each style change, Core keeps a recovery snapshot. Up to 20 named profiles and five recovery snapshots.";
      section.querySelectorAll("button").forEach((b) => (b.disabled = false));
    } catch (error) {
      status.textContent = error.message;
      name.disabled = true;
      section.querySelectorAll("button").forEach((b) => (b.disabled = true));
    }
  }
  for (const button of section.querySelectorAll("button"))
    button.onclick = async () => {
      const operation = button.dataset.profile;
      if (operation !== "save" && !picker.value) {
        status.textContent = "Choose a profile first.";
        return;
      }
      if (operation === "save" && !name.value.trim()) {
        status.textContent = "Enter a name for the current style.";
        name.focus();
        return;
      }
      section.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const current = await fetch("/api/control-deck", { cache: "no-store" }).then((r) =>
          r.json(),
        );
        const payload = {
          id: picker.value,
          name: name.value,
          profileRevision: state.revision,
          revision: current.value.revision,
        };
        if (operation === "restore") {
          const confirmed =
            section.querySelector('[data-profile="restore"]').dataset.confirm === picker.value;
          if (!confirmed) {
            button.dataset.confirm = picker.value;
            status.textContent =
              "Restore this profile's colors and animations? Actions stay as they are. Press Restore selected again to confirm.";
            return;
          }
          await request("POST", "/restore", payload);
          await refreshDeck(true);
          notice.textContent =
            "Style profile restored. The previous style is in recovery snapshots.";
        } else if (operation === "delete") {
          if (button.dataset.confirm !== picker.value) {
            button.dataset.confirm = picker.value;
            status.textContent =
              "Press Delete selected profile again to confirm. The current deck will stay unchanged.";
            return;
          }
          await request("DELETE", "/" + encodeURIComponent(picker.value), payload);
        } else {
          await request("POST", "", payload);
          name.value = "";
          notice.textContent = "Current deck style saved as a profile.";
        }
        await refresh();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        section.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };
  picker.onchange = () => {
    section.querySelectorAll("[data-confirm]").forEach((b) => delete b.dataset.confirm);
  };
  return { refresh };
}
