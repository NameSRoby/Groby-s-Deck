/** Exercise shipped catalogs and quiet cross-tab navigation with empty user data. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const createCore = require("../src/app/core/create-core-server");
const createExtension = require("../src/app/optional/create-feature-platform-extension");
const { stageOfflineFeatures } = require("../scripts/stage-offline-features");
test("fresh offline installation has public presets, styles and free navigation without running actions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-public-presets-"));
  const source = path.resolve(__dirname, "..");
  const bundled = path.join(root, "optional-components", "feature-packages");
  const installed = path.join(root, "features", "installed");
  await stageOfflineFeatures(source, bundled);
  assert.equal(fs.existsSync(installed), false);
  const created = createCore({
    rootDir: source,
    runtimeDir: path.join(root, "runtime"),
    dryRun: true,
    capabilities: { features: true },
    extend: createExtension({
      featuresRoot: installed,
      packageRoots: [bundled],
      installBundledDefaults: true,
      runtimeRoot: path.join(root, "workers"),
      allowUnsafeRuntime: false,
    }),
  });
  await created.extension.startup;
  const server = await new Promise((resolve) => {
    const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await created.extension.shutdown();
    await created.services.lifecycle.stopAll();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.youtube.com/**", (r) => r.abort());
  const base = "http://127.0.0.1:" + server.address().port;
  const api = async (url) => (await fetch(base + url)).json();
  const packages = await api("/api/features");
  assert.equal(
    packages.features.filter((f) => f.lifecycle === "active").length,
    2,
    JSON.stringify(packages.features.map((f) => [f.id, f.lifecycle, f.error])),
  );
  const catalog = await api("/api/control-deck/catalog");
  assert(catalog.value.presets.length >= 30);
  assert(catalog.value.presets.every((p) => p.public));
  const lightProfiles = (await api("/lighting-profiles")).profiles;
  assert.equal(lightProfiles.filter((p) => p.public).length, 7);
  assert(
    lightProfiles
      .filter((p) => p.public)
      .every((p) => Object.keys(p.fixtureTargets).length === 0 && !p.isDefault),
  );
  assert.equal(
    (await api("/api/control-deck/style-profiles")).value.profiles.filter((p) => p.public).length,
    10,
  );
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#setupGuide").waitFor();
  assert.equal(await page.locator("#setupFeatureList").isVisible(), false);
  await page.locator(".setupNext").click();
  assert.equal(await page.locator('[data-panel="fixtures"]').isVisible(), true);
  assert.equal(
    (await api("/api/presentation/setup")).features.find((f) => f.id === "lights").done,
    false,
  );
  assert.equal(await page.locator("[data-theme]").count(), 14);
  await page.locator('[data-tab="feature:twitch-integration"]').click();
  await page
    .locator('[data-panel="feature:twitch-integration"]')
    .getByRole("button", { name: "Rewards & automations", exact: true })
    .click();
  const frame = page.frameLocator('iframe[data-page-id="automations"]').frameLocator("#surface");
  await frame.locator("#commandExamples option").first().waitFor({ state: "attached" });
  assert.equal(await frame.locator("#commandExamples").isVisible(), true);
  const [presetRect, draftRect] = await Promise.all([
    frame.locator("#commandExamples").boundingBox(),
    frame.locator("#useCommandExample").boundingBox(),
  ]);
  assert(Math.abs(presetRect.y + presetRect.height - draftRect.y - draftRect.height) < 2);
  assert((await frame.locator("#commandExamples option").count()) > 100);
  assert.equal(await frame.locator(".automationItem").count(), 0);
  await frame.getByRole("button", { name: "Built-in features", exact: true }).click();
  assert.deepEqual(await frame.locator(".automationRowTitle strong").allTextContents(), [
    "Add to playlist",
    "Change lights",
    "Song Request",
    "Teach color",
  ]);
  await frame.getByRole("button", { name: "Channel Points", exact: true }).click();
  assert.equal(await frame.locator(".automationItem").count(), 0);
  await frame.locator("#commandExamples").selectOption("fight");
  await frame.locator("#useCommandExample").click();
  await frame.locator("#editor").waitFor({ state: "visible" });
  assert.equal(await frame.locator("#save").isDisabled(), true);
  await frame.getByRole("button", { name: "Connect Twitch", exact: true }).click();
  await page.locator('iframe[data-page-id="connection"]').waitFor();
  assert.equal(await page.locator(".relatedSetup").count(), 0);
  await page.evaluate(async () => {
    (await import("/feature-navigation.js")).openSetupDestination("songs");
  });
  const player = page.frameLocator('iframe[data-page-id="player"]').frameLocator("#surface");
  await player.locator("#songSetupPage").waitFor({ state: "visible" });
  await player.getByRole("button", { name: "Commands & rewards", exact: true }).click();
  await frame.locator(".automationExamples").waitFor({ state: "visible" });
  assert.equal(await frame.locator(".automationExamples").evaluate((el) => el.open), true);
  await page.locator('[data-tab="dashboard"]').click();
  assert.equal(await page.locator('#tabs [data-tab][aria-selected="true"]').count(), 1);
  await page.locator("#deckButtonMode").click();
  const awake = page.locator("#deckKeepAwake");
  assert.equal(await awake.evaluate((el) => getComputedStyle(el).opacity), "1");
  assert.match(await awake.innerText(), /Fullscreen only/);
  const wakeSwitch = page.getByRole("switch", { name: "Keep screen awake", exact: true });
  assert.equal((await wakeSwitch.boundingBox()).width, 30);
  await wakeSwitch.uncheck();
  assert.match(await awake.innerText(), /Off/);
  await wakeSwitch.check();
  assert.match(await awake.innerText(), /Fullscreen only/);
  assert((await page.locator("#setupGuide").boundingBox()).height < 85);
  await page.locator(".setupStepsToggle").click();
  assert.equal(await page.locator("#setupFeatureList li").count(), 5);
  await page.getByRole("button", { name: "Skip Lights setup", exact: true }).click();
  await page.locator('[data-setup-feature="lights"][data-state="skipped"]').waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".setupStepsToggle").click();
  await page.locator('[data-setup-feature="lights"][data-state="skipped"]').waitFor();
  await page.getByRole("button", { name: "Dismiss setup guidance", exact: true }).click();
  await page.locator("#setupGuide").waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#showSetupGuide").waitFor({ state: "attached" });
  assert.equal(await page.locator("#setupGuide").isVisible(), false);
  await page.locator("#themeButton").click();
  assert.equal(
    await page.locator("#themePanelActions").evaluate((node) => getComputedStyle(node).gap),
    "8px",
  );
  await page.locator("#showSetupGuide").click();
  await page.locator("#setupGuide").waitFor({ state: "visible" });
  await page.locator("#deckButtonMode").click();
  await page.locator("#deckAddButton").click();
  const picker = page.getByLabel("Public button preset", { exact: true });
  await picker.waitFor();
  assert.equal(await picker.locator("option").count(), catalog.value.presets.length + 1);
  assert.equal(await picker.locator("option:disabled").count(), 0);
  await picker.selectOption("viewer-intake");
  assert.equal(
    await page.locator("#deckButtonName").inputValue(),
    "Pause / resume rewards and chat",
  );
  assert(!fs.existsSync(path.join(root, "runtime", "system", "twitch-intake-pause.json")));
  await picker.selectOption("clip");
  await page.locator("#deckSaveButton").click();
  await picker.waitFor({ state: "hidden" });
  const deck = await api("/api/control-deck");
  const clip = deck.value.config.pages
    .flatMap((entry) => entry.buttons)
    .find((button) => button.title === "Clip the broadcast");
  assert.deepEqual(clip.steps[0].params, { duration: 30 });
  await page.locator("#deckEdit").click();
  await page.getByRole("button", { name: "Button settings", exact: true }).click();
  const styles = page.locator(".deckStyleProfiles");
  await styles.locator("summary").click();
  await styles.locator("select").selectOption("public-ocean");
  const apply = styles.getByRole("button", { name: "Apply selected", exact: true });
  await apply.click();
  await styles.getByRole("status").filter({ hasText: "again to confirm" }).waitFor();
  await apply.click();
  await page.getByText(/Style profile restored/).waitFor();
  assert.deepEqual(errors, []);
});
