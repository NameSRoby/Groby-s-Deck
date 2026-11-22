const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const { chromium } = require("playwright");
const createCore = require("../src/app/core/create-core-server");
const object = { type: "object", additionalProperties: false, properties: {} };
async function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}
test("Bingo deck mirrors a saved rectangular board and updates the OBS source", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-bingo-deck-"));
  const core = createCore({ runtimeDir, dryRun: true });
  const server = await listen(core.app),
    browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await core.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const layout = await fetch(base + "/api/stream-overlays", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: 0,
      document: {
        name: "Stream games",
        widgets: [{ type: "bingo", id: "board", gridSize: 10, gridRows: 3, items: ["First task"] }],
      },
    }),
  }).then((response) => response.json());
  assert.equal(layout.ok, true);
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const output = await browser.newPage();
  await page.goto(base);
  await page.locator("#deckButtonMode").click();
  await page.locator("#deckPages").getByRole("button", { name: "Bingo", exact: true }).click();
  await output.goto(base + "/stream-overlay.html?id=" + layout.selectedId);
  const first = page.getByRole("button", { name: "Square 1: First task" }),
    last = page.getByRole("button", { name: "Square 30: Square 30" });
  await first.waitFor();
  assert.equal(await page.locator(".deckBingoGrid button").count(), 30);
  await last.click();
  await page.getByRole("button", { name: "Square 30: Square 30", pressed: true }).waitFor();
  await output.locator(".bingoCell.marked").filter({ hasText: "Square 30" }).waitFor();
  await page.getByRole("button", { name: "Reset board" }).click();
  await page.getByRole("button", { name: "Clear marks" }).click();
  await page.getByRole("button", { name: "Square 30: Square 30", pressed: false }).waitFor();
  await output.locator(".bingoCell.marked").waitFor({ state: "detached" });
  await page.locator("#deckPages").getByRole("button", { name: "Quick Access" }).click();
  assert.equal(await page.locator("#deckBingo").isHidden(), true);
});
test("moved clipping mod opens its normal parameter editor even beside hundreds of built-in actions", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-clip-editor-"));
  const config = require("../src/domains/control-deck/control-deck-config").defaults();
  const clip = config.pages.flatMap((p) => p.buttons).find((b) => b.id === "twitch-clip");
  const { actionIds } = require("../src/shared/fs/upgrade-identifiers.json");
  const [retiredClip] = Object.keys(actionIds);
  clip.steps[0].actionId = retiredClip;
  fs.mkdirSync(path.join(runtimeDir, "system"), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "system", "control-deck.json"),
    JSON.stringify({ version: 1, revision: 4, audioPageAdded: true, config }),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../mods/twitch-clips/groby.mod.json"), "utf8"),
  );
  let executions = 0,
    enabled = false;
  const registry = {
    list: () => ({
      mods: [
        {
          id: manifest.id,
          name: manifest.name,
          lifecycle: enabled ? "active" : "installed-disabled",
          actions: manifest.contributes.actions,
        },
      ],
    }),
    readActionState: async () => ({
      ok: true,
      value: { feedback: { available: true, active: false, label: "Ready", state: "ready" } },
    }),
    invokeAction: async () => {
      executions++;
      return { ok: true };
    },
  };
  const e = createCore({
    runtimeDir,
    dryRun: true,
    fixtureSecretVaultOptions: require("./support/fixture-vault-codec.cjs"),
    desktopActions: {
      catalog: () =>
        Array.from({ length: 453 }, (_, i) => ({
          id: "native.example." + i,
          label: "Control " + i,
          group: "Example",
          parameters: object,
          defaults: {},
          available: true,
        })),
      shutdown() {},
    },
    extend: () => ({ owner: "fixture", mods: { registry }, shutdown: async () => {} }),
  });
  const server = await listen(e.app),
    browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await e.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.locator("#deckButtonMode").click();
  await page.locator("#deckEdit").click();
  await page.locator('[data-deck-button="twitch-clip"]').click();
  await page.locator("#deckEditor").waitFor();
  const duration = page.locator('#deckEditor [data-deck-parameter="duration"]');
  assert.equal(await duration.inputValue(), "30");
  assert.equal(await page.locator(`#deckEditor option[value="${retiredClip}"]`).count(), 0);
  assert.equal(
    await page.locator('#deckEditor option[value="mod:groby.twitch-clips:create"]').count(),
    1,
  );
  assert.match(
    await page.locator('#deckEditor option[value="mod:groby.twitch-clips:create"]').textContent(),
    /enable in Mods/,
  );
  assert.doesNotMatch(
    await page.locator("#deckEditor").textContent(),
    /Unavailable: mod:|Action data \(JSON\)/,
  );
  await duration.fill("45");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await page.locator("#deckEditor").waitFor({ state: "hidden" });
  const saved = e.services.controlDeck
    .snapshot()
    .config.pages.flatMap((p) => p.buttons)
    .find((b) => b.id === "twitch-clip");
  assert.equal(saved.steps[0].actionId, "mod:groby.twitch-clips:create");
  assert.equal(saved.steps[0].params.duration, 45);
  enabled = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#deckEdit").click();
  await page.locator('[data-deck-button="twitch-clip"]').click();
  await page.locator("#deckEditor").waitFor();
  assert.equal(
    await page.locator('#deckEditor option[value="mod:groby.twitch-clips:create"]').textContent(),
    "Clip stream",
  );
  assert.equal(executions, 0);
  assert.deepEqual(errors, []);
});

test("LAN deck edits safely, runs confirmed Discord actions, and preserves responsive layouts", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-deck-ui-"));
  let muted = false,
    presses = 0;
  const mod = {
    id: "groby.discord-controls",
    name: "Discord microphone",
    lifecycle: "active",
    actions: [
      {
        id: "microphone",
        title: "Discord microphone",
        symbol: "🎙",
        capability: "stream.discord.v1",
        method: "toggle",
        stateMethod: "status",
        parameters: object,
        defaults: {},
      },
    ],
  };
  const registry = {
    list: () => ({ mods: [mod] }),
    invokeAction: async () => {
      presses++;
      muted = !muted;
      return { ok: true, value: { muted } };
    },
    readActionState: async () => ({
      ok: true,
      value: {
        feedback: {
          label: muted ? "Muted" : "Unmuted",
          state: muted ? "muted" : "unmuted",
          active: muted,
          color: muted ? "#c82d50" : "#21a97d",
        },
      },
    }),
  };
  const desktop = {
    catalog: () => [],
    execute: async () => ({ ok: true }),
    integrations: async () => ({ discord: { bound: true, available: true, muted } }),
    shutdown: () => {},
  };
  const e = createCore({
    runtimeDir,
    dryRun: true,
    desktopActions: desktop,
    fixtureSecretVaultOptions: require("./support/fixture-vault-codec.cjs"),
    extend: () => ({ owner: "test-mods", mods: { registry }, shutdown: async () => {} }),
  });
  const initial = e.services.controlDeck.snapshot();
  initial.config.pages.flatMap((p) => p.buttons).find((b) => b.id === "discord-mic").steps = [
    { actionId: "mod:groby.discord-controls:microphone", params: {}, delayMs: 0 },
  ];
  e.services.controlDeck.save(initial.config, initial.revision);
  const server = await listen(e.app),
    reservation = await listen(http.createServer());
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((row) => row && row.family === "IPv4" && !row.internal)?.address;
  const local = `http://127.0.0.1:${server.address().port}`,
    base = `http://${lanAddress || "127.0.0.1"}:${port}`;
  const sharing = await fetch(local + "/api/network-sharing", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: local },
    body: JSON.stringify({ enabled: true, port }),
  });
  assert.equal(sharing.status, 200);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await e.services.lifecycle.stopAll();
    await new Promise((r) => server.close(r));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  if (lanAddress)
    assert.equal(
      await page.evaluate(() => window.isSecureContext),
      false,
      "exercise a genuine insecure LAN browser",
    );
  await page.locator("#deckButtonMode").click();
  await page.locator("#controlDeck").waitFor();
  assert.equal(await page.locator("#deckPages").isVisible(), true);
  assert.equal(
    await page
      .locator("#deckPages")
      .getByRole("button", { name: "Audio mixer", exact: true })
      .count(),
    1,
  );
  const mic = page.locator('[data-deck-button="discord-mic"]');
  await mic.waitFor();
  const square = await mic.boundingBox();
  assert.ok(Math.abs(square.width - square.height) < 1, "default buttons are square");
  assert.equal(await mic.evaluate((el) => getComputedStyle(el).borderRadius), "28px");
  await page.screenshot({
    path: path.resolve("runtime/control-deck-acrylic-default.png"),
    fullPage: true,
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="discord-mic"] .deckButtonState').textContent ===
      "Unmuted",
  );
  assert.equal(await mic.getAttribute("data-led-state"), "active");
  const unmutedLed = await mic
    .locator(".deckLedSource")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  const pressedAt = Date.now();
  await mic.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="discord-mic"]').getAttribute("aria-pressed") ===
      "true",
  );
  assert.equal(presses, 1);
  assert.equal(muted, true);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="discord-mic"]').getAttribute("data-led-state") ===
      "paused",
  );
  assert.ok(Date.now() - pressedAt < 1000, "confirmed button feedback arrives within one second");
  assert.equal(await mic.getAttribute("data-led-state"), "paused");
  assert.notEqual(
    await mic.locator(".deckLedSource").evaluate((el) => getComputedStyle(el).backgroundImage),
    unmutedLed,
    "the light shining through the face changes with confirmed mute state",
  );
  await page.locator("#deckEdit").click();
  assert.equal(
    await page.locator("#deckLayout").evaluate((el) => !!el.closest(".deckToolbar")),
    true,
  );
  assert.equal(
    await page.locator("#deckPageSettings").evaluate((el) => !!el.closest(".deckToolbar")),
    true,
  );
  assert.equal(
    await page.locator(".deckToolbar").evaluate((el) => getComputedStyle(el).position),
    "sticky",
  );
  await page.locator("#deckQuickDisplay").selectOption("text");
  await page.waitForFunction(
    () => document.querySelector('[data-deck-button="discord-mic"]').dataset.displayMode === "text",
  );
  assert.equal(await mic.locator(".deckButtonSymbol").isVisible(), false);
  await page.locator("#deckQuickDisplay").selectOption("auto");
  await page.getByText("Display and row count saved.", { exact: true }).waitFor();
  await page.locator("#deckQuickColumns").selectOption("6");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#deckGrid")).gridTemplateColumns.split(" ")
        .length === 6,
  );
  await page.locator("#deckQuickColumns").selectOption("5");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#deckGrid")).gridTemplateColumns.split(" ")
        .length === 5,
  );
  await mic.click();
  await page.locator("#deckEditor").waitFor();
  assert.equal(presses, 1, "edit mode never executes a live action");
  await page.locator("#deckButtonName").fill("My microphone");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.locator("#deckButtonColor").fill("#164959");
  await page.locator("#deckButtonBacklight").fill("80");
  await page.locator("#deckButtonImage").setInputFiles({
    name: "dot.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  });
  await page.getByText("Image ready. Save the button to use it.", { exact: true }).waitFor();
  await page.locator("#deckSaveButton").click();
  await page.locator("#deckEditor").waitFor({ state: "hidden" });
  assert.equal(await mic.getAttribute("aria-label"), "My microphone");
  assert.equal(
    await mic.evaluate((el) =>
      getComputedStyle(el.querySelector(".deckLedSource")).getPropertyValue("--deck-color"),
    ),
    await mic.evaluate((el) => getComputedStyle(el).getPropertyValue("--deck-color")),
    "the recessed LED follows the chosen button color",
  );
  await page.locator("#deckEdit").click();
  await mic.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="discord-mic"]').getAttribute("aria-pressed") ===
      "false",
  );
  assert.equal(presses, 2);
  assert.equal(muted, false);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="discord-mic"]').getAttribute("data-led-state") ===
      "active",
  );
  assert.equal(await mic.getAttribute("data-led-state"), "active");
  await page.locator("#deckEdit").click();
  await page.locator("#deckSetup").click();
  await page.getByRole("heading", { name: "Keyboard buttons", exact: true }).waitFor();
  await page.locator("#deckIntegrationsClose").click();
  await page.locator("#deckLayout").click();
  await page.locator("#deckLayoutColumns").fill("6");
  await page.locator("#deckLayoutTabletColumns").fill("3");
  await page.locator("#deckLayoutPhoneColumns").fill("3");
  await page.locator("#deckLayoutGap").fill("8");
  await page.locator("#deckLayoutRadius").fill("4");
  await page.locator("#deckLayoutLabelScale").fill("110");
  await page.locator("#deckLayoutShape").selectOption("wide");
  await page.locator("#deckLayoutShowStatus").uncheck();
  await page.locator("#deckLayoutSave").click();
  await page.locator("#deckLayoutEditor").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("#deckGrid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    6,
  );
  assert.equal(await mic.evaluate((el) => getComputedStyle(el).borderRadius), "4px");
  await page.locator("#deckLayout").click();
  await page.locator("#deckLayoutColumns").fill("2");
  await page.locator("#deckLayoutClose").click();
  assert.equal(
    await page
      .locator("#deckGrid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    6,
    "cancel discards the layout preview",
  );
  await page.getByRole("button", { name: "Remove My microphone", exact: true }).click();
  await mic.waitFor({ state: "detached" });
  await page.locator("#deckUndo").click();
  await mic.waitFor();
  const source = await mic.boundingBox(),
    target = await page.locator('[data-deck-button="twitch-clip"]').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  assert.equal(await page.locator(".deckDragGhost").count(), 1);
  assert.equal(await mic.getAttribute("data-dragging"), "true");
  assert.equal(
    await page.locator('[data-deck-button="twitch-clip"]').getAttribute("data-drop"),
    "true",
  );
  await page.screenshot({ path: path.resolve("runtime/deck-drag-preview-08-private.png") });
  await page.mouse.up();
  assert.equal(await page.locator(".deckDragGhost").count(), 0);
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll("#deckGrid [data-deck-button]"),
        (el) => el.dataset.deckButton,
      ).indexOf("discord-deafen") <
      Array.from(
        document.querySelectorAll("#deckGrid [data-deck-button]"),
        (el) => el.dataset.deckButton,
      ).indexOf("discord-mic"),
  );
  assert.equal(presses, 2, "reordering and removing buttons never executes actions");
  const touch = await page.context().newCDPSession(page);
  const touchSource = await mic.boundingBox();
  const touchTarget = await page.locator('[data-deck-button="discord-deafen"]').boundingBox();
  const startPoint = {
    id: 1,
    x: touchSource.x + touchSource.width / 2,
    y: touchSource.y + touchSource.height / 2,
  };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [startPoint] });
  for (let i = 1; i <= 8; i++)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          id: 1,
          x: startPoint.x + ((touchTarget.x + touchTarget.width / 2 - startPoint.x) * i) / 8,
          y: startPoint.y + ((touchTarget.y + touchTarget.height / 2 - startPoint.y) * i) / 8,
        },
      ],
    });
  assert.equal(
    await page.locator(".deckDragGhost").count(),
    1,
    "touch can grab the center of a button",
  );
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => {
    const ids = [...document.querySelectorAll("#deckGrid [data-deck-button]")].map(
      (el) => el.dataset.deckButton,
    );
    return ids.indexOf("discord-mic") < ids.indexOf("discord-deafen");
  });
  assert.equal(presses, 2, "whole-surface touch dragging never executes an action");
  await touch.detach();
  const beforeStyle = (await (await fetch(local + "/api/control-deck")).json()).value.config;
  await page.locator("#deckSettingsOpen").click();
  await page.locator("#deckStylePreset").selectOption("ice");
  await page.locator("#deckApplyStyle").click();
  await page
    .getByText("Style saved. Actions and artwork are unchanged. Undo is available on the deck.", {
      exact: true,
    })
    .waitFor();
  const afterStyle = (await (await fetch(local + "/api/control-deck")).json()).value.config;
  for (const button of afterStyle.pages[0].buttons) {
    assert.equal(button.appearance.color, "#63d9ff");
    const old = beforeStyle.pages[0].buttons.find((b) => b.id === button.id);
    assert.deepEqual(button.steps, old.steps);
    assert.equal(button.appearance.imageId, old.appearance.imageId);
  }
  await page.locator("#deckStyleScope").selectOption("button:discord-mic");
  await page.locator("#deckStylePreset").selectOption("aurora");
  await page.locator("#deckApplyStyle").click();
  await page.waitForFunction(
    () => document.querySelector('[data-deck-button="discord-mic"]').dataset.cycling === "true",
  );
  await page.locator("#deckSettingsClose").click();
  await page.screenshot({ path: path.resolve("runtime/control-deck-stream.png"), fullPage: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#controlDeck").isVisible(), true);
  assert.equal(await page.locator("#deckPages").isVisible(), true);
  assert.equal(await mic.getAttribute("aria-label"), "My microphone");
  await page.setViewportSize({ width: 820, height: 1180 });
  assert.equal(
    await page
      .locator("#deckGrid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    3,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator("#deckGrid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    3,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    (
      await fetch(base + "/api/control-deck/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  await page.locator("#deckFocus").click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "controlDeck");
  assert.equal(await page.locator(".deckToolbar").isVisible(), false);
  assert.equal(await page.locator("#deckAddButton").isVisible(), false);
  assert.equal(await page.locator("#deckExitFullscreen").isVisible(), true);
  await page.locator("#deckExitFullscreen").click();
  await page.waitForFunction(
    () =>
      !document.fullscreenElement &&
      document.querySelector("#controlDeck").dataset.focus === "false",
  );
  await page.evaluate(() => (document.querySelector("#controlDeck").requestFullscreen = undefined));
  await page.locator("#deckFocus").click();
  assert.equal(await page.locator(".deckToolbar").isVisible(), false);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".deckToolbar").isVisible(), true);
  await page.locator("#deckEdit").click();
  const previousOrder = await page
    .locator("#deckGrid [data-deck-button]")
    .evaluateAll((items) => items.map((el) => el.dataset.deckButton));
  const handle = page.locator(".deckDragHandle").first();
  await handle.scrollIntoViewIfNeeded();
  const touchFrom = await handle.boundingBox(),
    touchTo = await page.locator("#deckGrid [data-deck-button]").nth(2).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: touchFrom.x + touchFrom.width / 2, y: touchFrom.y + touchFrom.height / 2, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchTo.x + touchTo.width / 2, y: touchTo.y + touchTo.height / 2, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(
    (first) => document.querySelector("#deckGrid [data-deck-button]").dataset.deckButton !== first,
    previousOrder[0],
  );
  assert.equal(presses, 2, "touch rearranging never runs a button");
  await cdp.detach();
  assert.deepEqual(errors, []);
});
