/**
 * Core.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#request-security-and-the-feature-ui-relay
 */
const byId = (id) => document.getElementById(id);
let fixtures = [];
let fixtureConnectivity = new Map();
let fixtureTestState = new Map();
let fixtureGroups = [];
let twitchProgramUi;
let songRequestAvailable = false;
window.RaveLinkCoreUi = {
  request: (...args) => request(...args),
  fixtures: () => fixtures.slice(),
  refreshFixtures: () => loadFixtures(),
  showResult: (...args) => showResult(...args),
};
async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
const { showResult, redactDisplayString } = globalThis.initCoreResults(byId);
function maskedAddress(value) {
  return redactDisplayString(value || "hidden");
}
function setUnavailable(element, unavailable, reason = "") {
  if (!element) return;
  element.disabled = Boolean(unavailable);
  element.title = unavailable ? reason : "";
  if (unavailable && reason) {
    element.dataset.tooltip = reason;
    element.dataset.tooltipUnavailable = "true";
  } else if (element.dataset.tooltipUnavailable === "true") {
    delete element.dataset.tooltip;
    delete element.dataset.tooltipUnavailable;
  }
  element.setAttribute("aria-disabled", unavailable ? "true" : "false");
}
function setStatus(id, text, tone = "") {
  const element = byId(id);
  element.textContent = text;
  element.className = `statusLine${tone ? ` ${tone}` : ""}`;
}
function configuredLightFixtures() {
  return fixtures.filter((row) => {
    const connectivity = fixtureConnectivity.get(row.id);
    return row.enabled !== false && connectivity?.configured === true;
  });
}
function applyLightingReadiness() {
  const ready = configuredLightFixtures();
  const directReason =
    "Pair a Hue bridge or add a discovered WiZ or Govee fixture before controlling lights.";
  const twitchReady = ready.some((row) => row.twitchEnabled === true);
  const twitchReason =
    "Add and enable at least one Twitch-controlled fixture before programming channel-point routing.";
  for (const element of [
    byId("lightTarget"),
    byId("colorText"),
    byId("colorPicker"),
    byId("brightness"),
    byId("applyColor"),
    ...document.querySelectorAll("[data-color]"),
  ]) {
    setUnavailable(element, ready.length === 0, directReason);
  }
  setUnavailable(byId("twitchProgramControls"), !twitchReady, twitchReason);
  setStatus(
    "lightStatus",
    ready.length ? "READY" : "FIXTURE SETUP REQUIRED",
    ready.length ? "ok" : "warn",
  );
  byId("lightStatus").title = ready.length ? "" : directReason;
  widgetSetup.updateReadiness();
}

function showDiscoveryResult(result) {
  const output = byId("fixtureActionResult");
  byId("fixtureActionResultDeveloperDetails")?.remove();
  output.hidden = false;
  output.style.color = "#c9d8ff";
  output.replaceChildren();
  const heading = document.createElement("strong");
  const kindLabel =
    result.kind === "hue"
      ? "Hue bridge"
      : result.kind === "govee"
        ? "Govee LAN device"
        : "WiZ device";
  heading.textContent = `${Number(result.count || 0)} ${kindLabel}${result.count === 1 ? "" : "s"} found`;
  output.append(heading);
  const targets = result.targets || [];
  if (result.kind === "hue" && targets.length === 0) {
    const empty = document.createElement("p");
    empty.textContent =
      "NO HUE BRIDGE FOUND // CHECK THAT THE BRIDGE IS POWERED AND ON THIS NETWORK";
    output.append(empty);
    return;
  }
  if (result.kind === "hue" && targets.length === 1) {
    void selectDiscoveredHue(targets[0]);
    return;
  }
  for (const target of targets) {
    const row = document.createElement("div");
    row.className = "discoveryRow";
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "8px 0",
      borderTop: "1px solid var(--edge)",
    });
    const label = document.createElement("span");
    label.textContent = `${target.label}  ${maskedAddress(target.addressHint)}`;
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = result.kind === "hue" ? "SELECT BRIDGE" : "ADD";
    use.onclick = async () => {
      try {
        if (result.kind === "hue") {
          use.disabled = true;
          use.textContent = "SELECTING";
          await selectDiscoveredHue(target);
        } else {
          const endpoint =
            result.kind === "govee" ? "/govee/onboarding/commit" : "/wiz/onboarding/commit";
          const saved = await request(endpoint, {
            method: "POST",
            body: JSON.stringify({
              selectionToken: target.selectionToken,
              zone: byId("fixtureZone").value,
            }),
          });
          label.textContent = `${target.label} added`;
          use.remove();
          await loadFixtures();
          showResult("fixtureActionResult", saved);
        }
      } catch (error) {
        showResult("fixtureActionResult", error.message, true);
      }
    };
    if (result.kind === "hue") row.append(label, use);
    else {
      row.append(label, use);
    }
    output.append(row);
  }
  if (["wiz", "govee"].includes(result.kind) && targets.length > 1) {
    const addAll = document.createElement("button");
    addAll.type = "button";
    addAll.textContent = "ADD ALL";
    addAll.onclick = async () => {
      try {
        const endpoint =
          result.kind === "govee" ? "/govee/onboarding/commit" : "/wiz/onboarding/commit";
        const saved = await request(endpoint, {
          method: "POST",
          body: JSON.stringify({
            selectionTokens: targets.map((row) => row.selectionToken),
            zone: byId("fixtureZone").value,
          }),
        });
        await loadFixtures();
        showResult("fixtureActionResult", saved);
      } catch (error) {
        showResult("fixtureActionResult", error.message, true);
      }
    };
    output.append(addAll);
  }
}

async function selectDiscoveredHue(target) {
  try {
    const selected = await request("/hardware/discovery/select", {
      method: "POST",
      body: JSON.stringify({ selectionToken: target.selectionToken }),
    });
    byId("fixtureBrand").value = "hue";
    syncFixtureBrandUi();
    byId("fixtureBridgeIp").value = selected.address || "";
    syncHuePairButton();
    const output = byId("fixtureActionResult");
    const heading = document.createElement("strong");
    heading.textContent = "HUE BRIDGE SELECTED";
    const next = document.createElement("p");
    next.textContent =
      "NEXT: PRESS THE PHYSICAL BUTTON ON THE HUE BRIDGE, THEN SELECT 2 // PAIR SELECTED BRIDGE";
    output.replaceChildren(heading, next);
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  }
}

async function connectHuePair(prepared) {
  const output = byId("fixtureActionResult");
  output.hidden = false;
  const status = document.createElement("p");
  status.textContent = "CONNECTING TO HUE BRIDGE";
  output.replaceChildren(status);
  const response = await fetch("/hue/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingToken: prepared.pairingToken }),
  });
  const result = await response.json();
  if (response.ok && result.ok) return showHueSetup(result);
  status.textContent =
    result.error === "link_button_timeout"
      ? "LINK BUTTON NOT DETECTED // PRESS THE PHYSICAL BUTTON, THEN SELECT 2 // PAIR SELECTED BRIDGE AGAIN"
      : result.paired
        ? "BRIDGE PAIRED, BUT LIGHT INVENTORY IS UNAVAILABLE // SELECT PAIR AGAIN TO RETRY"
        : redactDisplayString(result.error || "HUE CONNECTION FAILED");
}

function syncHuePairButton() {
  setUnavailable(
    byId("pairHueManual"),
    !byId("fixtureBridgeIp").value.trim(),
    "Discover a Hue bridge or enter its address first.",
  );
}

function showHueSetup(result) {
  const output = byId("fixtureActionResult");
  output.hidden = false;
  output.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = `${result.lights.length} Hue light${result.lights.length === 1 ? "" : "s"} ready`;
  const list = document.createElement("div");
  list.className = "hueLightList";
  for (const light of result.lights) {
    const row = document.createElement("label");
    row.className = "hueLightRow";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = String(light.lightId);
    const name = document.createElement("span");
    name.textContent = `${light.name}${light.productName ? `  ${light.productName}` : ""}`;
    row.append(checkbox, name);
    list.append(row);
  }
  const actions = document.createElement("div");
  actions.className = "discoveryActions";
  const area = document.createElement("select");
  area.setAttribute("aria-label", "Entertainment area");
  area.add(new Option("STANDARD LIGHT CONTROL", ""));
  for (const item of result.entertainmentAreas || []) area.add(new Option(item.name, item.id));
  const setupOptions = document.createElement("div");
  setupOptions.className = "hueSetupOptions";
  const zoneLabel = document.createElement("label");
  zoneLabel.textContent = "ZONE";
  const zone = document.createElement("input");
  zone.placeholder = "desk";
  zone.value = byId("fixtureZone").value;
  zoneLabel.append(zone);
  const twitchLabel = document.createElement("label");
  twitchLabel.className = "checkLabel";
  twitchLabel.title = "Allow Twitch color commands to control the selected Hue lights.";
  const twitch = document.createElement("input");
  twitch.type = "checkbox";
  twitch.checked = byId("fixtureTwitch").checked;
  twitchLabel.append(twitch, document.createTextNode(" TWITCH CONTROL"));
  setupOptions.append(zoneLabel, twitchLabel);
  const saveStatus = document.createElement("p");
  saveStatus.setAttribute("role", "status");
  const install = async (mode) => {
    const lightIds = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) =>
      Number(input.value),
    );
    try {
      const saved = await request("/hue/onboarding/commit", {
        method: "POST",
        body: JSON.stringify({
          setupToken: result.setupToken,
          mode,
          lightIds,
          entertainmentAreaId: area.value,
          zone: zone.value,
          twitchEnabled: twitch.checked,
        }),
      });
      await loadFixtures();
      showResult("fixtureActionResult", saved);
    } catch (error) {
      saveStatus.textContent = redactDisplayString(error.message);
    }
  };
  const selected = document.createElement("button");
  selected.type = "button";
  selected.textContent = "SAVE SELECTED";
  selected.onclick = () => install("selected");
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "SAVE WHOLE BRIDGE";
  all.onclick = () => install("all");
  actions.append(selected, all);
  output.append(heading, list, area, setupOptions, actions, saveStatus);
}

function escapeHtml(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

document.querySelectorAll("[data-tab]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-tab]")
      .forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("main > [data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== button.dataset.tab;
    });
  }),
);

const themes = {
  midnight: {
    accent: "#8b001f",
    bg: "#050507",
    surface: "#19191f",
    text: "#eaeaea",
    glow: 65,
  },
  ember: { accent: "#b95538", bg: "#100e10", surface: "#251e22", text: "#f8ede9", glow: 28 },
  ocean: { accent: "#227b9d", bg: "#0b111b", surface: "#172638", text: "#e9f3fc", glow: 24 },
  matrix: { accent: "#287d61", bg: "#0b1311", surface: "#192a25", text: "#edf7f1", glow: 20 },
  aurora: { accent: "#7755ac", bg: "#100e1a", surface: "#241f36", text: "#f3eefc", glow: 28 },
  solar: { accent: "#876626", bg: "#14120d", surface: "#2c261b", text: "#fbf4df", glow: 20 },
  slate: { accent: "#516a94", bg: "#0e1219", surface: "#202a39", text: "#eef2f8", glow: 16 },
  rosewood: { accent: "#a04b68", bg: "#160e14", surface: "#2d1e29", text: "#faedf3", glow: 24 },
  forest: { accent: "#577640", bg: "#10140f", surface: "#242d20", text: "#f1f5eb", glow: 18 },
};

let themeEditRevision = 0;
const saveSharedTheme = createSharedThemeSaver(() => {
  byId("glowValue").title = "App colors are local; overlay theme sync could not be saved.";
});
function applyTheme(theme, persist = true) {
  const value = { ...themes.midnight, ...(theme || {}) };
  value.surface = window.GrobyPresentationColors(value).surface;
  const root = document.documentElement.style;
  for (const [key, color] of Object.entries(window.GrobyPresentationColors(value)))
    root.setProperty("--" + key, color);
  root.setProperty("--glow", String(value.glow / 100));
  byId("themeAccent").value = value.accent;
  byId("themeBg").value = value.bg;
  byId("themeSurface").value = value.surface;
  byId("themeText").value = value.text;
  byId("themeGlow").value = value.glow;
  byId("glowValue").value = `${value.glow}%`;
  document.querySelectorAll("[data-theme]").forEach((button) => {
    const preset = themes[button.dataset.theme];
    button.setAttribute(
      "aria-pressed",
      String(
        ["accent", "bg", "surface", "text", "glow"].every((key) => preset[key] === value[key]),
      ),
    );
  });
  if (persist) {
    themeEditRevision++;
    localStorage.setItem("ravelink.hud.theme", JSON.stringify(value));
    saveSharedTheme(value);
  }
}

function customTheme() {
  return {
    accent: byId("themeAccent").value,
    bg: byId("themeBg").value,
    surface: byId("themeSurface").value,
    text: byId("themeText").value,
    glow: Number(byId("themeGlow").value),
  };
}

byId("themeButton").onclick = () => {
  byId("themePanel").hidden = !byId("themePanel").hidden;
};
byId("closeTheme").onclick = () => {
  byId("themePanel").hidden = true;
};
byId("resetTheme").onclick = () => applyTheme(themes.midnight);
document.querySelectorAll("[data-theme]").forEach((button) => {
  button.style.setProperty("--preset-accent", themes[button.dataset.theme].accent);
  button.onclick = () => applyTheme(themes[button.dataset.theme]);
});
for (const id of ["themeAccent", "themeBg", "themeSurface", "themeText", "themeGlow"])
  byId(id).oninput = () => applyTheme(customTheme());
try {
  applyTheme(JSON.parse(localStorage.getItem("ravelink.hud.theme")), false);
} catch {
  applyTheme(themes.midnight, false);
}
void (async () => {
  const started = themeEditRevision;
  try {
    const response = await fetch("/api/presentation/theme", {
        cache: "no-store",
      }),
      body = await response.json();
    if (!body.ok || started !== themeEditRevision) return;
    if (body.revision > 0) {
      applyTheme(body.theme, false);
      localStorage.setItem("ravelink.hud.theme", JSON.stringify(body.theme));
    } else saveSharedTheme(customTheme());
  } catch {}
})();
const developerMode = byId("developerMode");
developerMode.checked = localStorage.getItem("ravelink.hud.developerMode") === "true";
document.documentElement.dataset.developerMode = String(developerMode.checked);
developerMode.onchange = () => {
  localStorage.setItem("ravelink.hud.developerMode", String(developerMode.checked));
  document.documentElement.dataset.developerMode = String(developerMode.checked);
};

function clearFixtureForm() {
  window.RaveLinkHueSetup?.load();
  byId("fixtureBrand").value = "hue";
  byId("fixtureId").value = "";
  byId("fixtureName").value = "";
  byId("fixtureZone").value = "";
  byId("fixtureLightId").value = "1";
  byId("fixtureIp").value = "";
  byId("fixtureBridgeIp").value = "";
  byId("fixtureEnabled").checked = true;
  byId("fixtureTwitch").checked = true;
  byId("showFixtureAddresses").checked = false;
  byId("fixtureIp").type = "password";
  byId("fixtureBridgeIp").type = "password";
  syncFixtureBrandUi();
}

function syncFixtureBrandUi() {
  const brand = byId("fixtureBrand").value;
  document
    .querySelectorAll("[data-fixture-brand]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.fixtureBrand === brand)),
    );
  document.querySelectorAll("[data-fixture-brands]").forEach((field) => {
    field.hidden = !field.dataset.fixtureBrands.split(" ").includes(brand);
  });
}
byId("fixtureBrand").addEventListener("change", syncFixtureBrandUi);
document.querySelectorAll("[data-fixture-brand]").forEach((button) =>
  button.addEventListener("click", () => {
    Object.assign(byId("fixtureBrand"), {
      value: button.dataset.fixtureBrand,
    }).dispatchEvent(new Event("change", { bubbles: true }));
  }),
);
syncFixtureBrandUi();
byId("showFixtureAddresses").onchange = () => {
  const type = byId("showFixtureAddresses").checked ? "text" : "password";
  byId("fixtureIp").type = type;
  byId("fixtureBridgeIp").type = type;
};

function renderFixtures() {
  byId("hueCount").textContent = String(fixtures.filter((row) => row.brand === "hue").length);
  byId("wizCount").textContent = String(fixtures.filter((row) => row.brand === "wiz").length);
  byId("fixtureRows").innerHTML = fixtures.length
    ? fixtures
        .map((row) => {
          const connectivity = fixtureConnectivity.get(row.id);
          const state = !row.enabled
            ? "DISABLED"
            : fixtureTestState.get(row.id)?.status ||
              String(
                connectivity?.status ||
                  (row.credentialsConfigured || row.deviceIpConfigured
                    ? "untested"
                    : "not_configured"),
              )
                .replaceAll("_", " ")
                .toUpperCase();
          return `<tr><td><strong>${escapeHtml(row.name || row.id)}</strong><br><span class="sub">${escapeHtml(row.id)}</span></td><td>${escapeHtml(row.brand).toUpperCase()}${row.brand === "hue" ? `<br><span class="sub">${row.entertainmentConfigured ? "ENTERTAINMENT CONFIGURED" : "STANDARD CONTROL"}</span>` : ""}</td><td>${escapeHtml(row.zone || "-")}</td><td>${row.twitchEnabled ? "TWITCH" : "OFF"}</td><td>${escapeHtml(state)}</td><td><div class="actions compact"><button data-fixture-test="${escapeHtml(row.id)}">TEST</button><button data-fixture-edit="${escapeHtml(row.id)}">EDIT</button><button class="danger" data-fixture-delete="${escapeHtml(row.id)}">DELETE</button></div></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6">NO FIXTURES CONFIGURED</td></tr>';
  renderLightTargets();
  applyLightingReadiness();
}

function fixtureTestFailure(error) {
  const messages = {
    hue_light_not_found:
      "The bridge responded, but this light ID no longer exists. Reconnect the Hue bridge to refresh its lights.",
    hue_lights_query_failed:
      "The Hue bridge did not return its light inventory. Check bridge power and network access, then test again.",
    hue_lights_transport_unavailable:
      "Hue networking is unavailable. Restart Groby’s Deck and check the local network connection.",
    wiz_probe_timeout:
      "The WiZ light did not answer. Confirm it is powered and on the same local network, then rediscover WiZ.",
    wiz_probe_failed:
      "The WiZ light could not be reached. Rediscover WiZ to refresh its saved address.",
    wiz_probe_transport_unavailable: "WiZ network probing is unavailable on this system.",
    govee_probe_timeout:
      "The Govee light did not answer. Enable LAN Control in Govee Home, confirm it is powered and on this network, then rediscover it.",
    govee_probe_failed: "The Govee light could not be reached over its local LAN API.",
    govee_probe_transport_unavailable: "Govee LAN probing is unavailable on this system.",
    fixture_not_found: "This fixture is no longer saved. Refresh the fixture list.",
  };
  return (
    messages[error] ||
    `The fixture test failed (${String(error || "unknown error").replaceAll("_", " ")}). Check its pairing and network settings.`
  );
}

function renderLightTargets() {
  const select = byId("lightTarget");
  const current = select.value || "all";
  const options = [
    ["all", "ALL LIGHTS"],
    ["brand:hue", "ALL HUE"],
    ["brand:wiz", "ALL WIZ"],
    ["brand:govee", "ALL GOVEE"],
    ...fixtureGroups
      .filter((row) => row.enabled !== false && row.fixtureIds?.length)
      .map((row) => [`group:${row.id}`, `GROUP: ${row.name}`]),
    ...[...new Set(fixtures.map((row) => row.zone).filter(Boolean))]
      .sort()
      .map((zone) => [`zone:${zone}`, `ZONE: ${zone.toUpperCase()}`]),
    ...fixtures.map((row) => [
      `fixture:${row.id}`,
      `${String(row.brand).toUpperCase()}: ${row.name || row.id}`,
    ]),
  ];
  if (current.startsWith("group:") && !options.some(([value]) => value === current))
    options.push([current, "GROUP UNAVAILABLE"]);
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  select.value = options.some(([value]) => value === current) ? current : "all";
  twitchProgramUi?.refreshFixtures();
}

async function loadFixtures() {
  const result = await request("/fixtures");
  fixtures = result.fixtures || [];
  fixtureConnectivity = new Map((result.connectivity?.rows || []).map((row) => [row.id, row]));
  renderFixtures();
}

byId("fixtureRows").onclick = async (event) => {
  const edit = event.target.closest("[data-fixture-edit]");
  const test = event.target.closest("[data-fixture-test]");
  const remove = event.target.closest("[data-fixture-delete]");
  if (test) {
    test.disabled = true;
    test.textContent = "TESTING";
    try {
      const result = await request(
        `/fixtures/${encodeURIComponent(test.dataset.fixtureTest)}/test`,
        { method: "POST", body: "{}" },
      );
      fixtureTestState.set(test.dataset.fixtureTest, { status: "REACHABLE" });
      showResult(
        "fixtureActionResult",
        `${result.fixture?.name || "Fixture"} responded successfully.`,
      );
    } catch (error) {
      fixtureTestState.set(test.dataset.fixtureTest, { status: "UNREACHABLE" });
      showResult("fixtureActionResult", fixtureTestFailure(error.message), true);
    } finally {
      test.disabled = false;
      test.textContent = "TEST";
    }
    renderFixtures();
  }
  if (edit) {
    const row = fixtures.find((item) => item.id === edit.dataset.fixtureEdit);
    if (!row) return;
    try {
      const detail = (await request(`/fixtures/${encodeURIComponent(row.id)}/edit`)).fixture;
      window.RaveLinkHueSetup?.load(detail);
      byId("fixtureBrand").value = detail.brand;
      syncFixtureBrandUi();
      byId("fixtureId").value = detail.id;
      byId("fixtureName").value = detail.name || detail.id;
      byId("fixtureZone").value = detail.zone || "";
      byId("fixtureLightId").value = detail.lightId || 1;
      byId("fixtureIp").value = detail.ip || "";
      byId("fixtureBridgeIp").value = detail.bridgeIp || "";
      byId("fixtureEnabled").checked = detail.enabled !== false;
      byId("fixtureTwitch").checked = detail.twitchEnabled === true;
      byId("showFixtureAddresses").checked = false;
      byId("fixtureIp").type = "password";
      byId("fixtureBridgeIp").type = "password";
    } catch (error) {
      showResult("fixtureActionResult", error.message, true);
    }
  }
  if (remove && confirm(`Delete fixture ${remove.dataset.fixtureDelete}?`)) {
    try {
      await request(`/fixtures/${encodeURIComponent(remove.dataset.fixtureDelete)}`, {
        method: "DELETE",
      });
      await loadFixtures();
    } catch (error) {
      showResult("fixtureActionResult", error.message, true);
    }
  }
};

byId("saveFixture").onclick = async () => {
  try {
    const result = await request("/fixtures", {
      method: "POST",
      body: JSON.stringify({
        id: byId("fixtureId").value,
        name: byId("fixtureName").value,
        brand: byId("fixtureBrand").value,
        zone: byId("fixtureZone").value,
        lightId: Number(byId("fixtureLightId").value),
        ip: byId("fixtureIp").value,
        bridgeIp: byId("fixtureBridgeIp").value,
        enabled: byId("fixtureEnabled").checked,
        twitchEnabled: byId("fixtureTwitch").checked,
      }),
    });
    showResult("fixtureActionResult", result);
    clearFixtureForm();
    await loadFixtures();
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  }
};
byId("clearFixture").onclick = clearFixtureForm;
byId("refreshFixtures").onclick = () =>
  loadFixtures().catch((error) => showResult("fixtureActionResult", error.message, true));
byId("discoverHue").onclick = async () => {
  byId("discoverHue").disabled = true;
  byId("discoverHue").textContent = "SEARCHING FOR HUE BRIDGE";
  try {
    showDiscoveryResult(await request("/hue/discover"));
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  } finally {
    byId("discoverHue").disabled = false;
    byId("discoverHue").textContent = "1 // DISCOVER HUE";
  }
};
byId("discoverWiz").onclick = async () => {
  try {
    showDiscoveryResult(await request("/wiz/discover"));
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  }
};
byId("discoverGovee").onclick = async () => {
  const button = byId("discoverGovee");
  button.disabled = true;
  button.textContent = "SEARCHING FOR GOVEE";
  try {
    showDiscoveryResult(await request("/govee/discover"));
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "FIND GOVEE LIGHTS";
  }
};
byId("pairHueManual").onclick = async () => {
  const bridgeIp = byId("fixtureBridgeIp").value;
  if (!bridgeIp)
    return showResult("fixtureActionResult", "Enter a Hue bridge address or use discovery.", true);
  try {
    byId("pairHueManual").disabled = true;
    byId("pairHueManual").textContent = "PAIRING";
    await connectHuePair(
      await request("/hue/pair/prepare", {
        method: "POST",
        body: JSON.stringify({ bridgeIp }),
      }),
    );
  } catch (error) {
    showResult("fixtureActionResult", error.message, true);
  } finally {
    byId("pairHueManual").textContent = "2 // PAIR SELECTED BRIDGE";
    syncHuePairButton();
  }
};
byId("fixtureBridgeIp").addEventListener("input", syncHuePairButton);
syncHuePairButton();

byId("applyColor").onclick = async () => {
  setStatus("lightStatus", "APPLYING", "warn");
  const selection = byId("lightTarget").value;
  const text = byId("colorText").value || byId("colorPicker").value;
  const body = {
    text: /(?:^|\s)(?:dim|bright|\d{1,3}%)(?:\s|$)/i.test(text)
      ? text
      : `${text} ${byId("brightness").value}%`,
  };
  if (selection.startsWith("brand:")) body.target = selection.slice(6);
  else if (selection.startsWith("zone:")) {
    body.target = "both";
    body.zone = selection.slice(5);
  } else if (selection.startsWith("fixture:")) body.fixtureId = selection.slice(8);
  else if (selection.startsWith("group:")) body.groupId = selection.slice(6);
  else body.target = "both";
  try {
    const result = await request("/color", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const dryRun =
      result.hueDelivery?.dryRun || result.wizDelivery?.dryRun || result.goveeDelivery?.dryRun;
    const destination =
      Array.isArray(result.targets) && result.targets.length
        ? result.targets.join(", ")
        : "no fixtures";
    const command = `${result.hex || "brightness only"} at ${result.brightnessPercent}%`;
    const summary = dryRun
      ? `Dry run: ${command} matched ${destination}. No hardware command sent.`
      : `${command} sent to ${destination}. ${result.sent || 0} dispatched, ${result.failed || 0} failed (${result.skippedTargets || 0} missing or disabled).`;
    showResult("colorResult", summary);
    setStatus(
      "lightStatus",
      dryRun ? "DRY RUN" : result.partial ? "PARTIAL" : "APPLIED",
      dryRun || result.partial ? "warn" : "ok",
    );
  } catch (error) {
    showResult("colorResult", error.message, true);
    setStatus("lightStatus", "FAILED", "bad");
  }
};
byId("colorText").onkeydown = (event) => {
  if (event.key === "Enter") byId("applyColor").click();
};
byId("colorPicker").oninput = () => {
  byId("colorText").value = byId("colorPicker").value;
};
byId("brightness").oninput = () => {
  byId("brightnessValue").value = `${byId("brightness").value}%`;
};
document.querySelectorAll("[data-color]").forEach(
  (button) =>
    (button.onclick = () => {
      byId("colorText").value = button.dataset.color;
    }),
);

async function runControlRoutingTest(text) {
  const output = byId("controlRoutingTestResult");
  output.hidden = false;
  output.style.color = "#c9d8ff";
  output.textContent = "ROUTING COMMAND...";
  try {
    const result = await request("/twitch/lights/test", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const targets = Array.isArray(result.targets) ? result.targets : [];
    output.textContent = result.effect
      ? `${String(result.effect).toUpperCase()} // ${targets.length} TARGETS${result.synchronized ? " // SYNCHRONIZED" : ""}\n${targets.join(", ") || "No active targets"}`
      : `${result.hex || result.directiveType || "COLOR"} // ${Number(result.sent || 0)} SENT // ${Number(result.failed || 0)} FAILED\n${targets.join(", ") || "No active targets"}`;
  } catch (error) {
    output.textContent = error.message;
    output.style.color = "var(--bad)";
  }
}
byId("runControlRoutingTest").onclick = () =>
  runControlRoutingTest(byId("controlRoutingTestInput").value);
byId("stopControlRoutingTest").onclick = () => runControlRoutingTest("stop");
byId("controlRoutingTestInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runControlRoutingTest(event.currentTarget.value);
  }
});

const widgetSetup = globalThis.initWidgetSetup({
  byId,
  request,
  setStatus,
  setUnavailable,
  hasFixtures: () => configuredLightFixtures().length > 0,
  hasSongRequest: () => songRequestAvailable,
});
const loadUpdateStatus = globalThis.initCoreUpdates({ byId, request });

async function boot() {
  try {
    const status = await request("/system/status");
    byId("health").textContent = "Online";
    byId("health").className = "badge ok";
    byId("network").className = "badge ok";
    fixtures = status.fixtures?.items || [];
    fixtureConnectivity = new Map(
      (status.fixtures?.connectivity?.rows || []).map((row) => [row.id, row]),
    );
    songRequestAvailable = status.capabilities?.songRequest === true;
    void loadUpdateStatus();
    renderFixtures();
    widgetSetup.applySecurity(status.widgetSecurity);
    twitchProgramUi = await import("/twitch-light-program.js").then((module) =>
      module.initTwitchLightProgram({
        request,
        initialState: status.twitchLightRouting,
        initialEffectState: status.twitchLightEffects,
        getFixtures: () => fixtures,
        changed: (groups) => {
          fixtureGroups = groups;
          renderLightTargets();
        },
      }),
    );
    if (status.capabilities?.features === true) {
      byId("featuresTab").hidden = false;
      await import("/features.js").then((module) => module.initFeaturePlatform());
    }
    if (status.capabilities?.mods === true) {
      byId("modsSectionTab").hidden = false;
      byId("featuresTab").hidden = false;
      await import("/mods.js").then((module) => module.initModPlatform());
    }
  } catch (error) {
    byId("health").textContent = "Offline";
    byId("health").className = "badge bad";
    byId("network").className = "badge bad";
  }
}

boot();
