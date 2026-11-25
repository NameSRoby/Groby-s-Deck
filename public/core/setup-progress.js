/** Setup dismissal changes guidance only. It never disables features or runs actions. */
import { openSetupDestination } from "./feature-navigation.js";
const definitions = [
  ["lights", "Lights", "Pair or add fixtures", "fixtures"],
  ["twitch", "Twitch", "Connect your channel", "twitch"],
  ["music", "Music & requests", "Choose and connect a player", "songs"],
  ["deck", "Button deck", "Use the starter deck or choose buttons", "deck"],
  ["overlays", "Overlays", "Save your first overlay", "overlays"],
];
export function createSetupGuide() {
  const guide = document.createElement("section");
  guide.id = "setupGuide";
  guide.className = "setupGuide";
  guide.hidden = true;
  guide.setAttribute("aria-label", "Setup progress");
  guide.innerHTML =
    '<div class="setupGuideHead"><strong>Setup</strong><span class="setupProgress" role="status"></span><button type="button" class="setupNext"></button><button type="button" class="setupStepsToggle" aria-expanded="false" aria-controls="setupFeatureList">Steps</button><button type="button" class="setupDismiss" aria-label="Dismiss setup guidance">Dismiss</button></div><ol id="setupFeatureList" class="setupFeatureList" hidden></ol><p class="setupGuideNotice" role="status" hidden></p>';
  document.getElementById("tabs").after(guide);
  const list = guide.querySelector("ol"),
    progress = guide.querySelector(".setupProgress"),
    next = guide.querySelector(".setupNext"),
    notice = guide.querySelector(".setupGuideNotice");
  let state,
    busy = false,
    closed = false,
    timer,
    reviewing = false;
  const open = (destination) => {
    if (destination === "overlays") document.querySelector('[data-tab="overlays"]')?.click();
    else openSetupDestination(destination);
  };
  const rows = definitions.map(([id, title, help, destination]) => {
    const row = document.createElement("li"),
      label = document.createElement("span"),
      status = document.createElement("span"),
      go = document.createElement("button"),
      skip = document.createElement("button");
    row.dataset.setupFeature = id;
    status.className = "setupFeatureState";
    label.className = "setupFeatureLabel";
    const name = document.createElement("strong"),
      text = document.createElement("small");
    name.textContent = title;
    text.textContent = help;
    label.append(name, text);
    go.type = skip.type = "button";
    go.textContent = "Set up";
    skip.textContent = "Skip";
    go.onclick = () => open(destination);
    skip.onclick = () =>
      void change(state.features.find((f) => f.id === id)?.skipped ? "restore" : "skip", id);
    skip.title = "Hide this setup step; feature controls remain available.";
    row.append(status, label, go, skip);
    list.append(row);
    return { id, title, help, destination, row, status, go, skip };
  });
  function render() {
    if (!state) return;
    guide.hidden = !reviewing && (state.dismissed || state.completed);
    const included = state.features.filter((f) => !f.skipped);
    progress.textContent = state.completed
      ? "Complete"
      : `${included.filter((f) => f.done).length} of ${included.length} ready`;
    let pending;
    for (const row of rows) {
      const value = state.features.find((f) => f.id === row.id);
      row.row.dataset.state = value.skipped ? "skipped" : value.done ? "done" : "pending";
      row.status.textContent = value.skipped ? "Skipped" : value.done ? "Ready" : "Pending";
      row.go.textContent = value.done || value.skipped ? "Open" : "Set up";
      row.skip.textContent = value.skipped ? "Restore" : "Skip";
      row.skip.setAttribute(
        "aria-label",
        `${value.skipped ? "Restore" : "Skip"} ${row.title} setup`,
      );
      if (!value.done && !value.skipped && !pending) pending = row;
    }
    next.hidden = !pending;
    if (pending) {
      next.textContent = pending.help + " \u203a";
      next.onclick = () => open(pending.destination);
    }
  }
  async function request(method = "GET", body) {
    const response = await fetch("/api/presentation/setup", {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error);
    return result;
  }
  async function refresh() {
    clearTimeout(timer);
    if (closed || busy || document.hidden) return;
    busy = true;
    try {
      state = await request();
      render();
    } catch {
      /* Setup status must not obstruct the app. */
    } finally {
      busy = false;
      if (!closed && !guide.hidden) timer = setTimeout(refresh, 10000);
    }
  }
  async function change(action, feature) {
    if (busy || !state) return;
    busy = true;
    guide.querySelectorAll("button").forEach((b) => (b.disabled = true));
    notice.hidden = true;
    try {
      state = await request("PUT", {
        action,
        revision: state.revision,
        ...(feature ? { feature } : {}),
      });
      if (action === "dismiss") reviewing = false;
      render();
    } catch {
      notice.textContent = "Could not save setup preferences. Refresh and try again.";
      notice.hidden = false;
    } finally {
      busy = false;
      guide.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
  guide.querySelector(".setupDismiss").onclick = () => void change("dismiss");
  guide.querySelector(".setupStepsToggle").onclick = (event) => {
    list.hidden = !list.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!list.hidden));
  };
  const show = document.createElement("button");
  show.type = "button";
  show.id = "showSetupGuide";
  show.textContent = "Review setup";
  show.onclick = async () => {
    reviewing = true;
    await refresh();
    if (state) {
      await change("show");
      guide.scrollIntoView({ block: "nearest" });
    }
    document.getElementById("themePanel").hidden = true;
  };
  document.getElementById("themePanel").append(show);
  window.addEventListener("ravelink:feature-call-complete", () => {
    if (!guide.hidden) void refresh();
  });
  window.addEventListener("ravelink:setup-changed", () => {
    if (!guide.hidden) void refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  addEventListener("pagehide", () => {
    closed = true;
    clearTimeout(timer);
  });
  addEventListener("pageshow", () => {
    closed = false;
    void refresh();
  });
  void refresh();
  return guide;
}
