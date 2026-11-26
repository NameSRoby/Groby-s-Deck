/**
 * Feature navigation.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#request-security-and-the-feature-ui-relay
 */
import { describeFeatureFailure, createFeatureFailureDetails } from "./feature-failure.js";
const views = new Map();
const presentations = new WeakMap();
const themeKeys = [
  "bg",
  "panel",
  "surface",
  "accent",
  "edge",
  "text",
  "muted",
  "ok",
  "warn",
  "bad",
  "input",
  "accent-text",
  "accent-glow",
];
function presentation() {
  const style = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries(
    themeKeys.map((key) => [key, style.getPropertyValue(`--${key}`).trim()]),
  );
  const developerMode = document.documentElement.dataset.developerMode === "true";
  return {
    channel: "ravelink-feature-ui-v1",
    type: "presentation",
    theme,
    developerMode,
    profile: document.documentElement.dataset.workspaceProfile || "normal",
  };
}
function present(frame, message, signature = JSON.stringify(message)) {
  if (presentations.get(frame) === signature) return;
  presentations.set(frame, signature);
  frame.contentWindow?.postMessage(message, location.origin);
}
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.channel !== "ravelink-feature-ui-v1") return;
  for (const [id, view] of views) {
    const frame = [...view.panel.querySelectorAll(".featurePageFrame")].find(
      (item) => item.contentWindow === event.source,
    );
    if (!frame) continue;
    if (
      event.data.type === "feature-setup-link" &&
      ["twitch", "songs", "presets", "deck", "lights"].includes(event.data.destination)
    ) {
      openSetupDestination(event.data.destination);
      return;
    }
    if (event.data.type === "feature-ready") {
      frame.dataset.ready = "true";
      presentations.delete(frame);
      present(frame, presentation());
      if (frame.playlistStart) {
        frame.contentWindow.postMessage(frame.playlistStart, location.origin);
        frame.playlistStart = null;
      }
      if (frame.setupView) {
        frame.contentWindow.postMessage(frame.setupView, location.origin);
        frame.setupView = null;
      }
    }
    if (event.data.type === "feature-height" && Number.isFinite(event.data.height)) {
      const height = `${Math.max(240, Math.min(200000, Math.ceil(event.data.height)))}px`;
      if (frame.style.height !== height) frame.style.height = height;
    }
    if (event.data.type === "feature-open") {
      if (
        id === "song-request" &&
        frame.dataset.pageId === "server-playlist" &&
        event.data.pageId === "player" &&
        event.data.startPlayback === true &&
        ["youtube", "soundcloud"].includes(event.data.provider)
      )
        view.startPlaylist(event.data.provider);
      else openFeaturePage(id, event.data.pageId);
    }
    if (
      event.data.type === "feature-call-complete" &&
      event.data.featureId === id &&
      /^[a-z][a-z0-9.]{1,79}$/.test(event.data.capability) &&
      /^[a-z][a-z0-9-]{0,39}$/.test(event.data.method)
    ) {
      window.dispatchEvent(
        new CustomEvent("ravelink:feature-call-complete", {
          detail: {
            featureId: id,
            capability: event.data.capability,
            method: event.data.method,
          },
        }),
      );
    }
    break;
  }
});
let presentationFrame;
new MutationObserver(() => {
  if (presentationFrame) return;
  presentationFrame = requestAnimationFrame(() => {
    presentationFrame = null;
    const message = presentation();
    const signature = JSON.stringify(message);
    for (const view of views.values())
      for (const frame of view.panel.querySelectorAll(".featurePageFrame[data-ready]"))
        present(frame, message, signature);
  });
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style", "data-developer-mode", "data-workspace-profile"],
});

export function openFeaturePage(featureId, pageId, setupTarget = "") {
  const view = views.get(featureId);
  if (!view) return false;
  selectMainTab(view.tab.dataset.tab);
  view.open(pageId, setupTarget);
  return true;
}

export function openSetupDestination(destination) {
  if (destination === "fixtures") {
    selectMainTab("fixtures");
    document.querySelector('[data-panel="fixtures"]')?.scrollIntoView({ block: "start" });
    return;
  }
  if (destination === "deck") {
    selectMainTab("dashboard");
    document.getElementById("deckButtonMode")?.click();
    document.getElementById("controlDeck")?.scrollIntoView({ block: "start" });
    return;
  }
  if (destination === "lights") {
    selectMainTab("lights");
    return;
  }
  const targets = {
    twitch: ["twitch-integration", "connection", ""],
    songs: ["song-request", "player", "song-setup"],
    presets: ["twitch-integration", "automations", "automation-presets"],
  };
  const target = targets[destination];
  if (target && openFeaturePage(...target)) return;
  selectMainTab("features");
}

export function selectMainTab(key) {
  const mods = key === "mods";
  if (mods) key = "features";
  const updates = key === "updates";
  if (updates) key = "features";
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const selected = button.dataset.tab === key;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll("main > [data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== key;
  });
  if (mods) document.querySelector('[data-maintenance="mods"]')?.click();
  if (updates) {
    document.querySelector('[data-maintenance="packages"]')?.click();
    document.getElementById("coreUpdates")?.scrollIntoView({ block: "start" });
  }
}

export function syncFeatureNavigation(features) {
  // Keep an unexpectedly stopped workspace discoverable without mounting dead
  // worker pages. Explicitly disabled packages still leave navigation normally.
  const visibleFeatures = features.filter(
    (feature) =>
      feature.id !== "music-to-light" &&
      (feature.lifecycle === "active" ||
        (["crashed", "quarantined", "incompatible", "permission-required"].includes(
          feature.lifecycle,
        ) &&
          (feature.enabledOnStartup || views.has(feature.id))) ||
        (views.has(feature.id) &&
          ["active_rss_limit", "idle_cpu_limit"].includes(feature.stateReason))) &&
      (feature.uiContributions || []).length > 0,
  );
  const ids = new Set(visibleFeatures.map((row) => row.id));
  for (const [id, view] of views) {
    if (ids.has(id)) continue;
    if (!view.panel.hidden) selectMainTab("features");
    view.tab.remove();
    view.panel.remove();
    views.delete(id);
  }
  for (const feature of visibleFeatures) {
    const signature = JSON.stringify([
      feature.version,
      feature.pid,
      feature.lifecycle,
      feature.error,
      feature.stateReason,
      feature.uiContributions,
    ]);
    let view = views.get(feature.id);
    if (!view) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tabButton";
      tab.dataset.tab = `feature:${feature.id}`;
      const panel = document.createElement("section");
      panel.className = "panel featureWorkspace";
      panel.dataset.panel = tab.dataset.tab;
      panel.hidden = true;
      const moreNav = document.getElementById("moreNav");
      document.getElementById("tabs").insertBefore(tab, moreNav || null);
      document.querySelector('[data-panel="features"]').after(panel);
      view = { tab, panel, signature: "", open: () => {} };
      tab.onclick = () => {
        selectMainTab(tab.dataset.tab);
        view.open();
      };
      views.set(feature.id, view);
    }
    const title = feature.name.toUpperCase();
    if (view.tab.textContent !== title) view.tab.textContent = title;
    if (view.signature === signature) continue;
    view.signature = signature;
    view.panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = title;
    view.panel.append(heading);
    if (feature.lifecycle !== "active") {
      const notice = document.createElement("p");
      notice.setAttribute("role", "status");
      notice.textContent = ["active_rss_limit", "idle_cpu_limit"].includes(feature.stateReason)
        ? `${feature.name} stopped after exceeding its resource budget. Open Packages to review its status and restart it.`
        : `${feature.name} stopped unexpectedly or could not start. ${describeFeatureFailure(feature).description} (${describeFeatureFailure(feature).code})`;
      const manage = document.createElement("button");
      manage.type = "button";
      manage.textContent = "Open Packages";
      manage.onclick = () => selectMainTab("features");
      view.panel.append(notice, createFeatureFailureDetails(feature), manage);
      view.open = () => {};
      continue;
    }
    const tabs = document.createElement("nav");
    tabs.className = "tabs featureSubtabs";
    tabs.setAttribute("aria-label", `${feature.name} views`);
    const surface = document.createElement("div");
    const overlayTools = document.createElement("div");
    overlayTools.className = "overlaySourceTools";
    overlayTools.hidden = true;
    const overlayLabel = document.createElement("label");
    overlayLabel.textContent = "OBS BROWSER SOURCE URL";
    const overlayUrl = document.createElement("input");
    overlayUrl.readOnly = true;
    overlayLabel.append(overlayUrl);
    const copyOverlayUrl = document.createElement("button");
    copyOverlayUrl.type = "button";
    copyOverlayUrl.textContent = "COPY URL";
    copyOverlayUrl.dataset.tooltip = "Copy the clean overlay address for an OBS Browser Source.";
    const overlaySizeLabel = document.createElement("label");
    overlaySizeLabel.textContent = "OBS SOURCE SIZE";
    const overlaySize = document.createElement("input");
    overlaySize.readOnly = true;
    overlaySize.value = "1280 x 720";
    overlaySizeLabel.append(overlaySize);
    const overlayNotice = document.createElement("span");
    overlayNotice.className = "statusLine";
    copyOverlayUrl.onclick = async () => {
      try {
        await navigator.clipboard.writeText(overlayUrl.value);
        overlayNotice.textContent = "URL COPIED";
        overlayNotice.className = "statusLine ok";
      } catch {
        overlayUrl.select();
        overlayNotice.textContent = "SELECTED // PRESS CTRL+C";
        overlayNotice.className = "statusLine warn";
      }
    };
    overlayTools.append(overlayLabel, overlaySizeLabel, copyOverlayUrl, overlayNotice);
    const frames = new Map();
    let selected = "";
    const open = (page) => {
      selected = page.id;
      overlayTools.hidden = page.surface !== "overlay";
      if (page.surface === "overlay") {
        const sourceUrl = new URL(
          `/features-ui/${encodeURIComponent(feature.id)}/${encodeURIComponent(page.id)}`,
          location.origin,
        );
        sourceUrl.searchParams.set("v", feature.version);
        overlayUrl.value = sourceUrl.href;
        overlayNotice.textContent =
          feature.id === "song-request" && page.id === "obs-overlay"
            ? "SET WIDTH 1280 // HEIGHT 720 // KEEP SCALE 100%"
            : "PASTE THIS URL INTO OBS";
        overlayNotice.className = "statusLine";
      }
      let frame = frames.get(page.id);
      if (!frame) {
        frame = document.createElement("iframe");
        frame.className = "featurePageFrame";
        frame.dataset.surface = page.surface;
        frame.dataset.pageId = page.id;
        if (feature.id === "song-request" && page.id === "player") frame.allow = "autoplay";
        frame.title = `${feature.name}: ${page.title}`;
        frame.referrerPolicy = "no-referrer";
        // The host wrapper contains the existing opaque-origin contribution sandbox.
        frame.src = `/features-ui/${encodeURIComponent(feature.id)}/${encodeURIComponent(page.id)}`;
        surface.append(frame);
        frames.set(page.id, frame);
      }
      frames.forEach((item, id) => {
        item.hidden = id !== page.id;
      });
      [...tabs.children].forEach((button) => {
        const active = button.dataset.page === page.id;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
    };
    const pages = feature.uiContributions || [];
    tabs.hidden = pages.length < 2;
    for (const page of pages) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tabButton";
      button.dataset.page = page.id;
      button.textContent = page.title;
      button.onclick = () => open(page);
      tabs.append(button);
    }
    view.startPlaylist = (provider) => {
      const page = pages.find((row) => row.id === "player");
      if (!page) return;
      selectMainTab(view.tab.dataset.tab);
      open(page);
      const frame = frames.get("player"),
        message = {
          channel: "ravelink-feature-ui-v1",
          type: "playlist-start",
          provider,
        };
      if (frame.dataset.ready === "true") frame.contentWindow.postMessage(message, location.origin);
      else frame.playlistStart = message;
    };
    view.panel.append(tabs, overlayTools, surface);
    view.open = (pageId, setupTarget = "") => {
      const requested = pages.find((page) => page.id === pageId);
      if (requested) open(requested);
      else if (!selected && pages.length) open(pages[0]);
      if (["song-setup", "automation-presets"].includes(setupTarget)) {
        const frame = frames.get(pageId);
        if (frame) {
          const message = {
            channel: "ravelink-feature-ui-v1",
            type: "setup-view",
            target: setupTarget,
          };
          if (frame.dataset.ready === "true")
            frame.contentWindow.postMessage(message, location.origin);
          else frame.setupView = message;
        }
      }
    };
    if (!view.panel.hidden) view.open();
  }
}
