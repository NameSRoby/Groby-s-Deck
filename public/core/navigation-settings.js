/**
 * Navigation settings.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#request-security-and-the-feature-ui-relay
 */
(() => {
  const nav = document.getElementById("tabs"),
    more = document.querySelector("#moreNav .moreNavMenu");
  const known = {
    dashboard: "Dashboard",
    lights: "Lights",
    fixtures: "Fixtures",
    widget: "Widget",
    features: "Updates & packages",
    overlays: "Overlay designer",
    soundboard: "Soundboard",
    "feature:song-request": "Song Request",
    "feature:twitch-integration": "Twitch Integration",
  };
  let saved = {},
    profile = "normal",
    loaded = false;
  const profiles = [
    ["normal", "Normal", "Standard spacing and top tabs"],
    ["compact", "Compact", "Smaller controls and tighter rows"],
    ["spacious", "Spacious", "Larger controls and more room"],
    ["sidebar", "Side navigation", "Keep workspaces on the left"],
  ];
  const dialog = document.createElement("dialog");
  dialog.id = "navigationSettings";
  dialog.setAttribute("aria-labelledby", "workspaceLayoutTitle");
  dialog.innerHTML = `
    <h2 id="workspaceLayoutTitle">Workspace layout</h2>
    <div class="workspaceLayoutBody">
      <fieldset class="workspaceProfiles"><legend>Layout profile</legend>
        ${profiles
          .map(
            ([id, name, explanation]) => `
          <label class="workspaceProfile" data-profile="${id}">
            <input type="radio" name="workspaceProfile" value="${id}" aria-label="${name}">
            <span class="workspaceProfilePreview" aria-hidden="true"><i></i><b></b><b></b><b></b></span>
            <strong>${name}${id === "normal" ? " <small>Default</small>" : ""}</strong>
            <span>${explanation}</span>
          </label>`,
          )
          .join("")}
      </fieldset>
      <fieldset class="workspaceTabPlacement"><legend>Tab placement</legend>
        <div id="navigationChoices"></div>
      </fieldset>
    </div>
    <footer class="workspaceLayoutFooter">
      <p id="navigationNotice" role="status"></p>
      <div class="actions"><button id="saveNavigation" class="primary">Save layout</button><button id="resetNavigation">Use default layout</button><button id="closeNavigation">Cancel</button></div>
    </footer>`;
  document.body.append(dialog);
  const profileInputs = [...dialog.querySelectorAll('input[name="workspaceProfile"]')];
  const chosenProfile = () => profileInputs.find((input) => input.checked)?.value || profile;
  const applyProfile = (value) => {
    if (document.documentElement.dataset.workspaceProfile !== value)
      document.documentElement.dataset.workspaceProfile = value;
  };
  dialog.querySelector(".workspaceProfiles").onchange = () => applyProfile(chosenProfile());
  dialog.addEventListener("close", () => applyProfile(profile));
  const open = document.createElement("button");
  open.id = "customizeTabs";
  open.type = "button";
  open.textContent = "CHOOSE TABS";
  open.onclick = () => {
    draw();
    dialog.showModal();
  };
  document.getElementById("themePanelActions").append(open);
  const menuOpen = document.createElement("button");
  menuOpen.type = "button";
  menuOpen.textContent = "CHOOSE TABS";
  menuOpen.onclick = () => {
    document.getElementById("moreNav").open = false;
    open.click();
  };
  more.append(menuOpen);
  const defaultMode = (id) =>
    [
      "dashboard",
      "lights",
      "fixtures",
      "widget",
      "feature:song-request",
      "feature:twitch-integration",
    ].includes(id)
      ? "main"
      : "more";
  function apply() {
    if (!loaded) return;
    applyProfile(dialog.open ? chosenProfile() : profile);
    for (const button of [...nav.querySelectorAll("[data-tab]")]) {
      const id = button.dataset.tab,
        mode = saved[id] || (id === "features" ? saved.updates : null) || defaultMode(id),
        target = mode === "main" ? nav : more;
      button.classList.toggle("navigationHidden", mode === "hidden");
      if (button.parentElement !== target) {
        if (target === nav) nav.insertBefore(button, document.getElementById("moreNav"));
        else more.insertBefore(button, menuOpen);
      }
    }
    const active = nav.querySelector("[data-tab].active");
    if (active?.classList.contains("navigationHidden")) {
      const next = [...nav.querySelectorAll("[data-tab]")].find(
        (button) => !button.hidden && !button.classList.contains("navigationHidden"),
      );
      next?.click();
    }
  }
  function draw() {
    for (const input of profileInputs) {
      input.checked = input.value === profile;
      input.disabled = !loaded;
    }
    const choices = document.getElementById("navigationChoices");
    choices.replaceChildren();
    for (const [id, name] of Object.entries(known)) {
      const label = document.createElement("label"),
        select = document.createElement("select");
      select.dataset.tabId = id;
      for (const [value, text] of [
        ["main", "Main tabs"],
        ["more", "More menu"],
        ["hidden", "Hidden"],
      ])
        select.add(new Option(text, value));
      select.value = saved[id] || (id === "features" ? saved.updates : null) || defaultMode(id);
      label.append(document.createTextNode(name), select);
      choices.append(label);
    }
    document.getElementById("navigationNotice").textContent = loaded
      ? ""
      : "Could not load your layout. Close this window and try again.";
    document.getElementById("saveNavigation").disabled = !loaded;
  }
  async function save(tabs, nextProfile) {
    const notice = document.getElementById("navigationNotice"),
      button = document.getElementById("saveNavigation");
    button.disabled = true;
    notice.textContent = "Saving tab layout…";
    try {
      const response = await fetch("/api/presentation/navigation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs, profile: nextProfile }),
      });
      const result = await response.json();
      if (response.status === 429)
        throw new Error(
          "Too many saves. Try again in " +
            (Number(response.headers.get("retry-after")) || 60) +
            " seconds.",
        );
      if (!response.ok || !result.ok) throw new Error("Could not save your tab layout.");
      saved = result.tabs;
      profile = result.profile || "normal";
      profileInputs.find((input) => input.value === profile).checked = true;
      apply();
      notice.textContent = "Tab layout saved.";
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      button.disabled = !loaded;
    }
  }
  document.getElementById("saveNavigation").onclick = () =>
    save(
      {
        ...saved,
        ...Object.fromEntries(
          [...dialog.querySelectorAll("select[data-tab-id]")].map((select) => [
            select.dataset.tabId,
            select.value,
          ]),
        ),
      },
      chosenProfile(),
    );
  document.getElementById("resetNavigation").onclick = async () => {
    await save({}, "normal");
    draw();
  };
  document.getElementById("closeNavigation").onclick = () => dialog.close();
  new MutationObserver((changes) => {
    if (
      changes.some((change) => [...change.addedNodes].some((node) => node.matches?.("[data-tab]")))
    )
      apply();
  }).observe(nav, { childList: true, subtree: true });
  fetch("/api/presentation/navigation")
    .then((response) => {
      if (!response.ok) throw new Error();
      return response.json();
    })
    .then((result) => {
      if (!result.ok) throw new Error();
      saved = result.tabs;
      profile = result.profile || "normal";
      loaded = true;
      if (dialog.open) draw();
      apply();
    })
    .catch(() => {});
})();
