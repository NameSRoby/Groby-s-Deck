/** Exercise shipped catalogs and quiet cross-tab navigation with empty user data. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const createCore = require("../src/app/core/create-core-server");
const createExtension = require("../src/app/optional/create-feature-platform-extension");
test("fresh offline installation has public presets, styles and free navigation without running actions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-public-presets-"));
  for (const id of ["song-request", "twitch-integration"])
    fs.cpSync(path.join(__dirname, "../features", id), path.join(root, "installed", id), {
      recursive: true,
    });
  const created = createCore({
    rootDir: path.resolve(__dirname, ".."),
    runtimeDir: path.join(root, "runtime"),
    dryRun: true,
    capabilities: { features: true },
    extend: createExtension({
      featuresRoot: path.join(root, "installed"),
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
  assert.equal(await page.locator("#setupGuide").evaluate((el) => el.open), false);
  assert.equal(await page.locator("[data-theme]").count(), 14);
  await page.locator('[data-tab="feature:twitch-integration"]').click();
  await page
    .locator('[data-panel="feature:twitch-integration"]')
    .getByRole("button", { name: "Rewards & automations", exact: true })
    .click();
  const frame = page.frameLocator('iframe[data-page-id="automations"]').frameLocator("#surface");
  await frame.locator("#commandExamples option").first().waitFor({ state: "attached" });
  assert((await frame.locator("#commandExamples option").count()) > 100);
  await frame.getByText("Public presets & starter recipes", { exact: true }).click();
  await frame.locator("#commandExamples").selectOption({ index: 1 });
  await frame.locator("#useCommandExample").click();
  await frame.locator("#editor").waitFor({ state: "visible" });
  assert.equal(await frame.locator("#save").isDisabled(), true);
  await frame.getByRole("button", { name: "Connect Twitch", exact: true }).click();
  await page.locator('iframe[data-page-id="connection"]').waitFor();
  await page
    .locator('[data-panel="feature:twitch-integration"]')
    .getByRole("button", { name: "Music player & request mode", exact: true })
    .click();
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
  await page.locator("#setupGuide > summary").click();
  assert((await page.locator("#setupGuide").boundingBox()).height < 240);
  assert.equal(await page.locator("#setupGuide .setupGuideShortcut").count(), 6);
  await page.locator("#setupGuide > summary").click();
  await page.locator("#deckAddButton").click();
  const picker = page.getByLabel("Public button preset", { exact: true });
  await picker.waitFor();
  await picker.selectOption("viewer-intake");
  assert(!fs.existsSync(path.join(root, "runtime", "system", "twitch-intake-pause.json")));
  assert.deepEqual(errors, []);
});
