/** Synthetic owners exercise the complete editor/runtime without sending PC input. */
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { chromium } = require("playwright"),
  createCore = require("../src/app/core/create-core-server");
async function fixture(t, withMessage = false) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-programming-")),
    calls = [];
  let flag = false;
  const core = createCore({
    runtimeDir,
    dryRun: true,
    desktopActions: {
      catalog: () =>
        ["on", "off", "state"]
          .map((name) => ({
            id: "native.demo-" + name,
            label: "Demo " + name,
            group: "Demo",
            symbol: "◆",
            available: true,
            ...(name === "state" ? { state: flag } : {}),
            defaults: {},
            parameters: { type: "object", additionalProperties: false, properties: {} },
          }))
          .concat(
            withMessage
              ? [
                  {
                    id: "native.demo-message",
                    label: "Demo message",
                    group: "Demo",
                    available: true,
                    defaults: { message: "" },
                    parameters: {
                      type: "object",
                      properties: { message: { type: "string", maxLength: 12000 } },
                      required: ["message"],
                    },
                  },
                ]
              : [],
          ),
      execute: async (id) => {
        calls.push(id);
        if (id === "native.demo-on") flag = true;
        if (id === "native.demo-off") flag = false;
        return { ok: true };
      },
      integrations: async () => ({}),
      shutdown: async () => {},
    },
  });
  const initial = core.services.controlDeck.snapshot();
  initial.config.mode = "deck";
  initial.config.pages = [{ id: "main", name: "Main", buttons: [] }];
  core.services.controlDeck.save(initial.config, initial.revision);
  const server = await new Promise((resolve) => {
    const server = core.app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await core.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, hasTouch: true }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  page.setDefaultTimeout(7000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator("#controlDeck").waitFor();
  return { page, core, calls };
}

test("deck action message fields use the same native highlighted editor and retain saved code", async (t) => {
  const { page, core, calls } = await fixture(t, true);
  await page.locator("#deckAddButton").click();
  await page.locator("#deckButtonName").fill("Code colors");
  await page.locator('[data-deck-action="native.demo-message"]').click();
  assert.equal(await page.locator("#deckEditorNotice").textContent(), "");
  const input = page.locator('[data-deck-parameter="message"]');
  const source = "${set roll 18}${if roll >= 16}${sender} wins${else}No${end}";
  await input.fill(source);
  await input.locator("..").locator(".commandToken-flow").filter({ hasText: "if" }).waitFor();
  assert.ok((await input.locator("..").locator(".commandToken-variable").count()) > 0);
  await page.locator("#deckSaveButton").click();
  await page.locator("#deckEditor").waitFor({ state: "hidden" });
  assert.equal(
    core.services.controlDeck.snapshot().config.pages[0].buttons[0].steps[0].params.message,
    source,
  );
  assert.deepEqual(calls, []);
});

test("bulk motion preserves distinct colors and cycles; named profiles restore appearance only", async (t) => {
  const { page, core, calls } = await fixture(t),
    service = core.services.controlDeck;
  const state = service.snapshot(),
    base = require("../src/domains/control-deck/control-deck-config").defaults().pages[0]
      .buttons[0];
  state.config.pages[0].buttons = ["red", "blue"].map((id, index) => ({
    ...structuredClone(base),
    id,
    title: id,
    appearance: {
      ...base.appearance,
      profileBacklight: "custom",
      backgroundSpeed: 91,
      backgroundStrength: 73,
      color: index ? "#1234ff" : "#ff3210",
      cycleColors: index ? ["#1234ff", "#00ffaa"] : [],
    },
  }));
  service.save(state.config, state.revision);
  await page.reload();
  await page.locator("#deckEdit").click();
  await page.getByRole("button", { name: "Button settings", exact: true }).click();
  const settings = page.locator("#deckSettings"),
    before = service.snapshot().config.pages[0].buttons;
  assert.equal(await settings.locator("#deckSharedBackgroundSpeed + output").textContent(), "91%");
  assert.equal(
    await settings.locator("#deckSharedBackgroundStrength + output").textContent(),
    "73%",
  );
  await settings.locator('#deckStyleEffect option[value="orbit"]').waitFor({ state: "attached" });
  await settings.locator("#deckStyleEffect").selectOption("orbit");
  assert.equal(await settings.locator("#deckStylePreset").inputValue(), "keep");
  await settings.locator("#deckApplyStyle").click();
  await settings.locator(".deckEditorNotice").filter({ hasText: "Style saved" }).waitFor();
  const animated = service.snapshot().config.pages[0].buttons;
  for (let i = 0; i < 2; i++) {
    assert.equal(animated[i].appearance.color, before[i].appearance.color);
    assert.deepEqual(animated[i].appearance.cycleColors, before[i].appearance.cycleColors);
    assert.equal(animated[i].appearance.backgroundProfile, "orbit");
  }
  const profiles = settings.locator(".deckStyleProfiles");
  await profiles.locator("summary").click();
  await profiles.locator("input").fill("Color coded");
  await profiles.getByRole("button", { name: "Save current style", exact: true }).click();
  await settings
    .locator(".deckEditorNotice")
    .filter({ hasText: "Current deck style saved" })
    .waitFor();
  const profile = service.styleProfiles().profiles.find((p) => p.name === "Color coded");
  assert.ok(profile);
  await settings.locator("#deckStylePreset").selectOption("ice");
  await settings.locator("#deckApplyStyle").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-deck-button="red"]').style.getPropertyValue("--deck-color") ===
      "#63d9ff",
  );
  await profiles.locator("select").selectOption(profile.id);
  await profiles.getByRole("button", { name: "Restore selected", exact: true }).click();
  await profiles.getByRole("button", { name: "Restore selected", exact: true }).click();
  await settings
    .locator(".deckEditorNotice")
    .filter({ hasText: "Style profile restored" })
    .waitFor();
  const restored = service.snapshot().config.pages[0].buttons;
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(restored[i].appearance, animated[i].appearance);
    assert.deepEqual(restored[i].steps, before[i].steps);
  }
  assert.deepEqual(calls, []);
});

test("one press follows an editable If / Then / Otherwise flow with multiple library actions, Together and Repeat blocks", async (t) => {
  const { page, core, calls } = await fixture(t);
  await page.locator("#deckAddButton").click();
  await page.locator("#deckButtonName").fill("Studio flow");
  const editor = page.locator("#deckEditor"),
    root = editor.locator(".deckSequence").first(),
    tools = root.locator(":scope > .deckSequenceTools");
  const pick = (id) => editor.locator(`[data-deck-action="native.demo-${id}"]`).click();
  await pick("on");
  await pick("off");
  assert.equal(
    await root.locator(":scope > .deckStepList > .deckStep").count(),
    2,
    "a second library choice appends instead of replacing the first",
  );
  await tools.getByRole("button", { name: "+ Add condition", exact: true }).click();
  const condition = root.locator('[data-step-kind="if"]').first();
  await condition
    .getByRole("combobox", { name: "If this action", exact: true })
    .selectOption("native.demo-state");
  await condition.getByRole("combobox", { name: "Check", exact: true }).selectOption("active");
  await condition
    .getByRole("combobox", { name: "Expected state", exact: true })
    .selectOption("false");
  await condition.getByRole("button", { name: "Add library actions to Then", exact: true }).click();
  await pick("off");
  await pick("on");
  await condition
    .getByRole("button", { name: "Add library actions to Otherwise", exact: true })
    .click();
  await pick("off");
  await tools.getByRole("button", { name: "+ Do together", exact: true }).click();
  const parallel = root.locator('[data-step-kind="parallel"]').first();
  await parallel
    .getByRole("button", { name: "Add library actions to Together", exact: true })
    .click();
  await pick("off");
  await pick("on");
  await tools.getByRole("button", { name: "+ Repeat block", exact: true }).click();
  const repeat = root.locator('[data-step-kind="repeat"]').first();
  await repeat.getByRole("spinbutton", { name: "Repeat block count", exact: true }).fill("2");
  await repeat
    .getByRole("button", { name: "Add library actions to Repeat actions", exact: true })
    .click();
  await pick("off");
  assert.deepEqual(calls, [], "building a flow never invokes its actions");
  await page.screenshot({ path: path.resolve("runtime/deck-if-then-flow-private.png") });
  await page.locator("#deckSaveButton").click();
  await editor.waitFor({ state: "hidden" });
  const saved = core.services.controlDeck.snapshot().config.pages[0].buttons[0];
  assert.equal(saved.steps.length, 5);
  assert.equal(saved.steps[2].then.length, 2);
  assert.equal(saved.steps[2].else.length, 1);
  assert.equal(saved.steps[3].steps.length, 2);
  const tile = page.locator("#deckGrid [data-deck-button]").first();
  await tile.click();
  await page.waitForFunction(
    () => document.querySelector(".deckButtonState")?.textContent === "Done",
  );
  assert.deepEqual(calls, [
    "native.demo-on",
    "native.demo-off",
    "native.demo-off",
    "native.demo-on",
    "native.demo-off",
    "native.demo-on",
    "native.demo-off",
    "native.demo-off",
  ]);
  await page.locator("#deckEdit").click();
  await tile.click();
  assert.equal(
    await root
      .locator('[data-step-kind="if"]')
      .first()
      .getByRole("combobox", { name: "Expected state", exact: true })
      .inputValue(),
    "false",
  );
  await page.setViewportSize({ width: 430, height: 932 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "the nested flow remains within the phone viewport",
  );
});
test("Actions and Appearance tabs retain drafts, support keyboard navigation and keep Save visible on phones", async (t) => {
  const { page, core, calls } = await fixture(t);
  await page.locator("#deckAddButton").click();
  const editor = page.locator("#deckEditor"),
    actions = editor.getByRole("tab", { name: "Actions", exact: true }),
    appearance = editor.getByRole("tab", { name: "Appearance", exact: true });
  assert.equal(await actions.getAttribute("aria-selected"), "true");
  await page.locator("#deckButtonName").fill("Tabbed demo");
  await editor.locator('[data-deck-action="native.demo-on"]').click();
  await appearance.click();
  assert.equal(await editor.locator(".deckActionLibrary").isVisible(), false);
  assert.equal(await editor.locator(".deckAppearanceEditor").isVisible(), true);
  await editor.locator("#deckButtonAnimation").selectOption("cycle");
  const cyclePreview = editor.getByLabel("Button appearance preview");
  assert.equal(await cyclePreview.getAttribute("data-cycling"), "true");
  const firstColor = await cyclePreview.evaluate((node) =>
    getComputedStyle(node).getPropertyValue("--deck-color"),
  );
  await page.waitForFunction(
    (previous) =>
      getComputedStyle(
        document.querySelector("#deckEditor .deckAppearancePreview"),
      ).getPropertyValue("--deck-color") !== previous,
    firstColor,
  );
  assert.equal(await editor.locator("#deckBackgroundProfile").isVisible(), false);
  await editor.locator("#deckButtonAnimation").selectOption("static");
  await editor.locator("#deckButtonColor").fill("#456789");
  await appearance.focus();
  await page.keyboard.press("Home");
  assert.equal(await actions.getAttribute("aria-selected"), "true");
  assert.equal(
    await editor.locator(".deckStepHeading select").first().inputValue(),
    "native.demo-on",
  );
  await page.keyboard.press("End");
  assert.equal(await appearance.getAttribute("aria-selected"), "true");
  assert.equal(await editor.locator("#deckButtonColor").inputValue(), "#456789");
  if (process.env.GROBYS_DECK_CAPTURE_EDITOR === "1")
    await editor.screenshot({
      path: path.join(__dirname, "../runtime/deck-editor-appearance-private.png"),
    });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = editor.locator("#deckAppearancePanel");
  await panel.evaluate((node) => (node.scrollTop = node.scrollHeight));
  assert.equal(await editor.evaluate((node) => node.scrollHeight <= node.clientHeight + 1), true);
  const save = await editor.locator("#deckSaveButton").boundingBox();
  assert.ok(save.y >= 0 && save.y + save.height <= 844);
  assert.equal(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await actions.click();
  assert.equal(await editor.locator(".deckAppearanceEditor").isVisible(), false);
  assert.deepEqual(calls, []);
  if (process.env.GROBYS_DECK_CAPTURE_EDITOR === "1")
    await editor.screenshot({
      path: path.join(__dirname, "../runtime/deck-editor-phone-private.png"),
    });
  await page.locator("#deckSaveButton").click();
  await editor.waitFor({ state: "hidden" });
  const saved = core.services.controlDeck.snapshot().config.pages[0].buttons[0];
  assert.equal(saved.appearance.color, "#456789");
  assert.equal(saved.steps[0].actionId, "native.demo-on");
});
test("visual editor creates timed/repeated actions, persists backgrounds, and stops on another press", async (t) => {
  const { page, core, calls } = await fixture(t);
  await page.locator("#deckAddButton").click();
  const editor = page.locator("#deckEditor"),
    sequence = editor.locator(".deckSequence").first();
  await page.locator("#deckButtonName").fill("Timed demo");
  await sequence.getByRole("button", { name: "Action → wait → action", exact: true }).click();
  const rows = sequence.locator(".deckStep");
  await rows.nth(0).locator(".deckStepHeading select").selectOption("native.demo-on");
  await rows.nth(1).getByRole("spinbutton", { name: "Wait for", exact: true }).fill("0.06");
  await rows.nth(2).locator(".deckStepHeading select").selectOption("native.demo-off");
  await page.locator("#deckRepeatCount").fill("2");
  await editor.getByRole("tab", { name: "Appearance", exact: true }).click();
  await editor.locator("#deckButtonAnimation").selectOption("smoke");
  assert.equal(
    await editor.getByLabel("Button appearance preview").getAttribute("data-background-profile"),
    "smoke",
  );
  assert.equal(
    await editor
      .locator(".deckButtonAtmosphere")
      .evaluate((node) => getComputedStyle(node).position),
    "absolute",
  );
  const movingLayer = editor.locator(".deckButtonAtmosphere");
  const firstTransform = await movingLayer.evaluate(
    (node) => getComputedStyle(node, "::before").transform,
  );
  await page.waitForFunction(
    (previous) =>
      getComputedStyle(document.querySelector("#deckEditor .deckButtonAtmosphere"), "::before")
        .transform !== previous,
    firstTransform,
  );
  assert.deepEqual(calls, [], "editing never executes the sequence");
  await page.locator("#deckSaveButton").click();
  await editor.waitFor({ state: "hidden" });
  const button = page.locator("#deckGrid [data-deck-button]").first();
  await button.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".deckButtonState")?.textContent === "Completed" ||
      document.querySelector(".deckButtonState")?.textContent === "Done",
  );
  assert.deepEqual(calls, [
    "native.demo-on",
    "native.demo-off",
    "native.demo-on",
    "native.demo-off",
  ]);
  const motion = page.getByRole("button", { name: "Pause button backgrounds", exact: true });
  await motion.click();
  assert.equal(
    await button
      .locator(".deckButtonAtmosphere")
      .evaluate((node) => getComputedStyle(node, "::before").animationPlayState),
    "paused",
  );
  await motion.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await button
      .locator(".deckButtonAtmosphere")
      .evaluate((node) => getComputedStyle(node, "::before").animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#deckEdit").click();
  await button.click();
  await editor
    .locator('[data-step-kind="wait"]')
    .getByRole("spinbutton", { name: "Wait for", exact: true })
    .fill("60");
  await page.locator("#deckSaveButton").click();
  await editor.waitFor({ state: "hidden" });
  await page.locator("#deckEdit").click();
  const before = calls.length;
  await button.click();
  await page.waitForFunction(() =>
    document.querySelector(".deckButtonState")?.textContent.includes("Waiting"),
  );
  assert.equal(await button.isEnabled(), true, "a running button stays usable for Stop");
  await button.click();
  await page.waitForFunction(
    () => document.querySelector(".deckButtonState")?.textContent === "Cancelled",
  );
  assert.deepEqual(calls.slice(before), ["native.demo-on"]);
  const saved = core.services.controlDeck.snapshot().config.pages[0].buttons[0];
  assert.equal(saved.repeatCount, 2);
  assert.equal(saved.cancelOnPress, true);
  assert.equal(saved.appearance.backgroundProfile, "smoke");
  await page.locator("#deckEdit").click();
  await page.getByRole("button", { name: "Button settings", exact: true }).click();
  const settings = page.locator("#deckSettings");
  await settings.locator("#deckStyleEffect").selectOption("aurora");
  await settings.locator("#deckStyleBacklight").fill("100");
  await settings.locator("#deckStyleBacklight").dispatchEvent("input");
  assert.equal(await settings.locator("#deckStyleLevel").textContent(), "100%");
  await settings.getByRole("button", { name: "Apply style", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#deckSettings .deckEditorNotice").textContent.startsWith("Style saved"),
  );
  assert.equal(
    core.services.controlDeck.snapshot().config.pages[0].buttons[0].appearance.backgroundProfile,
    "aurora",
  );
  assert.equal(
    core.services.controlDeck.snapshot().config.pages[0].buttons[0].appearance.backlight,
    100,
  );
  await settings.locator("#deckSettingsClose").click();
  await page.getByRole("button", { name: "Button settings", exact: true }).click();
  assert.equal(await settings.locator("#deckStyleEffect").inputValue(), "aurora");
  assert.equal(await settings.locator("#deckStyleBacklight").inputValue(), "100");
  await page.screenshot({ path: path.resolve("runtime/deck-programming-private.png") });
});
test("wait-first and duplicate controls preserve a chain longer than sixteen steps on a phone", async (t) => {
  const { page } = await fixture(t);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.locator("#deckAddButton").click();
  const editor = page.locator("#deckEditor"),
    sequence = editor.locator(".deckSequence").first();
  await sequence.getByRole("button", { name: "Wait first", exact: true }).click();
  for (let at = 0; at < 17; at++)
    await sequence.getByRole("button", { name: "Duplicate step", exact: true }).last().click();
  assert.equal(await sequence.locator(".deckStep").count(), 18);
  await sequence
    .locator(".deckStep")
    .last()
    .getByRole("button", { name: "Move action up", exact: true })
    .click();
  await sequence
    .locator(".deckStep")
    .first()
    .getByRole("button", { name: "Remove action", exact: true })
    .click();
  assert.equal(await sequence.locator(".deckStep").count(), 17);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("reduced-motion devices can explicitly enable animated backgrounds", async (t) => {
  const { page } = await fixture(t);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#deckAddButton").click();
  const editor = page.locator("#deckEditor");
  await editor.locator('[data-deck-action="native.demo-on"]').click();
  await editor.getByRole("tab", { name: "Appearance", exact: true }).click();
  await editor.locator("#deckButtonAnimation").selectOption("smoke");
  await page.locator("#deckSaveButton").click();
  await editor.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Pause button backgrounds" }).click();
  assert.equal(await page.locator("html").getAttribute("data-deck-motion-allowed"), "true");
  const layer = page.locator("#deckGrid .deckButtonAtmosphere").first();
  assert.notEqual(
    await layer.evaluate((node) => getComputedStyle(node, "::before").animationName),
    "none",
  );
  const before = await layer.evaluate((node) => getComputedStyle(node, "::before").transform);
  await page.waitForFunction(
    (value) =>
      getComputedStyle(document.querySelector("#deckGrid .deckButtonAtmosphere"), "::before")
        .transform !== value,
    before,
  );
});
