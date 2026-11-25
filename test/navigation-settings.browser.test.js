const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const createCore = require("../src/app/core/create-core-server");
test("tab placement saves locally, survives reload and supports moving tabs back from More or Hidden", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-navigation-"));
  const created = createCore({ runtimeDir, dryRun: true });
  const server = await new Promise((resolve) => {
    const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await created.services.lifecycle.stopAll();
    await new Promise((r) => server.close(r));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port,
    page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  // A failed optional worker must remain discoverable while its dead pages are
  // removed. Explicit disabling still removes its workspace as before.
  await page.evaluate(async () => {
    const navigation = await import("/feature-navigation.js");
    const feature = {
      id: "song-request",
      name: "Song Request",
      version: "fixture",
      pid: 1,
      lifecycle: "active",
      enabledOnStartup: true,
      uiContributions: [{ id: "player", title: "Player", surface: "panel" }],
    };
    navigation.syncFeatureNavigation([feature]);
    navigation.selectMainTab("feature:song-request");
    navigation.syncFeatureNavigation([
      {
        ...feature,
        lifecycle: "crashed",
        pid: 0,
        error:
          "activation_failed:song_settings_restore_failed: broker_timeout private-account-canary",
      },
    ]);
  });
  assert.equal(await page.locator('[data-tab="feature:song-request"]').count(), 1);
  assert.match(
    await page.locator('[data-panel="feature:song-request"]').innerText(),
    /stopped unexpectedly/,
  );
  assert.equal(await page.locator('[data-panel="feature:song-request"] iframe').count(), 0);
  const failedWorkspace = page.locator('[data-panel="feature:song-request"]');
  const startupReport = await failedWorkspace.getByLabel("Startup report").inputValue();
  assert.match(startupReport, /Code: startup_read_timeout/);
  assert.doesNotMatch(startupReport, /private-account-canary|broker_timeout/);
  await failedWorkspace.getByText("Startup details", { exact: true }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.copiedStartupReport = value;
        },
      },
    }),
  );
  await failedWorkspace.getByRole("button", { name: "Copy startup report", exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedStartupReport), startupReport);
  await page.getByRole("button", { name: "Open Packages", exact: true }).click();
  assert.equal(await page.locator('[data-panel="features"]').isVisible(), true);
  await page.evaluate(async () =>
    (await import("/feature-navigation.js")).syncFeatureNavigation([]),
  );
  assert.equal(await page.locator('[data-tab="feature:song-request"]').count(), 0);
  await page.locator("#themeButton").click();
  await page.locator("#customizeTabs").click();
  await page
    .locator('label:has(select[data-tab-id="widget"]) [data-choice-value="hidden"]')
    .click();
  await page
    .locator('label:has(select[data-tab-id="fixtures"]) [data-choice-value="more"]')
    .click();
  await page
    .locator('label:has(select[data-tab-id="features"]) [data-choice-value="main"]')
    .click();
  await page.locator("#saveNavigation").click();
  await page.locator("#navigationNotice").filter({ hasText: "Tab layout saved." }).waitFor();
  await page.locator("#closeNavigation").click();
  assert.equal(
    await page.locator("#themePanel").isVisible(),
    false,
    "working in the dialog dismisses the floating theme panel",
  );
  assert.equal(await page.locator('[data-tab="widget"]').isVisible(), false);
  assert.equal(await page.locator('#tabs > [data-tab="features"]').isVisible(), true);
  await page.locator("#moreNav > summary").click();
  await page.locator('#moreNav [data-tab="fixtures"]').click();
  assert.equal(await page.locator('[data-panel="fixtures"]').isVisible(), true);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator('[data-tab="widget"]').isVisible(), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(runtimeDir, "system/navigation.json"))).tabs.widget,
    "hidden",
  );
  const remote = await fetch(base + "/api/presentation/navigation", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.invalid",
    },
    body: JSON.stringify({ tabs: { widget: "main" } }),
  });
  assert.equal(remote.status, 403);
  const invalid = await fetch(base + "/api/presentation/navigation", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tabs: { widget: "delete" } }),
  });
  assert.equal(invalid.status, 400);
  await page.locator("#themeButton").click();
  await page.locator("#customizeTabs").click();
  await page.locator("#resetNavigation").click();
  await page
    .locator(
      'label:has(select[data-tab-id="widget"]) [data-choice-value="main"][aria-checked=true]',
    )
    .waitFor();
  await page.locator("#closeNavigation").click();
  assert.equal(await page.locator('[data-tab="widget"]').isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  assert.deepEqual(errors, []);
});

test("failed packages show a visible classified startup code and a report that excludes raw private errors", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-startup-report-"));
  const created = createCore({ runtimeDir, dryRun: true });
  const server = await new Promise((resolve) => {
    const server = created.app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await created.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  const feature = {
    id: "song-request",
    name: "Song Request",
    version: "0.45.26",
    lifecycle: "crashed",
    pid: 0,
    enabledOnStartup: true,
    error:
      "activation_failed:song_settings_restore_failed: broker_timeout C:\\private-account-canary\\token.json",
    provides: [],
    consumes: [],
    permissions: {},
    resources: { activeRssMiB: 384 },
    uiContributions: [{ id: "player", title: "Player", surface: "panel" }],
  };
  await page.route("**/api/features", (route) =>
    route.fulfill({ json: { ok: true, features: [feature], total: 1, active: 0 } }),
  );
  await page.route("**/api/features-available", (route) =>
    route.fulfill({ json: { ok: true, features: [] } }),
  );
  await page.goto("http://127.0.0.1:" + server.address().port, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await (await import("/features.js")).initFeaturePlatform();
  });
  const warning = page.locator("#featureCrashWarning");
  await warning.waitFor({ state: "visible" });
  assert.match(await warning.innerText(), /startup_read_timeout/);
  assert.doesNotMatch(await warning.innerText(), /private-account-canary|token.json/);
  await warning.getByRole("button", { name: "Open Packages", exact: true }).click();
  const report = page.locator("#featureRows").getByLabel("Startup report");
  await report.waitFor({ state: "visible" });
  assert.match(await report.inputValue(), /Version: 0.45.26/);
  assert.match(await report.inputValue(), /Code: startup_read_timeout/);
  assert.doesNotMatch(await report.inputValue(), /private-account-canary|token.json/);
});
