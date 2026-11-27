const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const createCoreServer = require("../src/app/core/create-core-server");

test("clean HUD boots and remains usable on desktop and mobile", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-hud-"));
  const { app, services } = createCoreServer({
    runtimeDir,
    dryRun: true,
    fixtureSecretVaultOptions: require("./support/fixture-vault-codec.cjs"),
  });
  const seeded = services.lightingCore.fixtureRegistry.upsertFixture({
    id: "incomplete-hue",
    brand: "hue",
    bridgeIp: "192.0.2.10",
    lightId: 1,
  });
  assert.equal(seeded.ok, true, seeded.error);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true });
  const url = `http://127.0.0.1:${server.address().port}`;

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const apiRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (["fetch", "xhr"].includes(request.resourceType()))
        apiRequests.push(new URL(request.url()).pathname);
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator('[data-tab="lights"]').click();
    await page.locator("#health").waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-tab="features"]').isVisible(), false);
    await page.locator("#moreNav > summary").click();
    assert.equal(await page.locator('[data-tab="features"]').isVisible(), true);
    assert.equal(await page.locator('[data-tab="updates"]').count(), 0);
    await page.locator('[data-tab="features"]').click();
    assert.equal(await page.locator('[data-panel="features"] #coreUpdates').isVisible(), true);
    assert.equal(await page.locator('[data-panel="features"] #featureRows').count(), 1);
    await page.locator("#moreNav > summary").click();

    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#modsTab").isVisible(), false);
    assert.equal(await page.locator('[data-tab="system"]').count(), 0);
    assert.equal(
      await page.locator('[data-tab="setup"], [data-panel="setup"], #finishSetupCard').count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
      true,
    );
    await page.locator('[data-tab="widget"]').click();
    assert.equal(await page.locator('[data-panel="widget"]').isVisible(), true);
    assert.equal(await page.locator("#widgetOutput").isVisible(), true);
    assert.equal(await page.locator(".workflowStep").count(), 3);
    assert.equal(await page.locator("#rotateIntakeToken").isEnabled(), true);
    assert.equal(await page.locator("#clearIntakeToken").isDisabled(), true);
    assert.equal(await page.locator("#developerMode").isChecked(), false);
    await page.locator("#themeButton").click();
    await page.locator("#developerMode").check();
    assert.equal(await page.locator("html").getAttribute("data-developer-mode"), "true");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("ravelink.hud.developerMode")),
      "true",
    );
    await page.locator("#closeTheme").click();
    assert.equal(await page.locator("#generateWidget").isDisabled(), true);
    assert.equal(await page.locator("#songRewardId").isVisible(), true);
    assert.match(
      await page.locator("#settlementNotice").textContent(),
      /no Twitch\s+authorization or Helix/i,
    );
    await page.locator("#colorRewardId").fill("reward-color");
    await page
      .locator("#widgetNotice")
      .filter({ hasText: "PAIR OR ADD A USABLE FIXTURE" })
      .waitFor();
    await page.locator('[data-tab="fixtures"]').click();
    assert.equal(await page.locator("[data-fixture-brand]").count(), 3);
    assert.equal(await page.locator(".goveeSetup").isVisible(), false);
    assert.equal(await page.locator("#discoverHue").isVisible(), true);
    await page.locator('[data-fixture-brand="wiz"]').click();
    assert.equal(await page.locator("#fixtureIpField").isVisible(), true);
    assert.equal(await page.locator("#fixtureBridgeIpField").isVisible(), false);
    assert.equal(await page.locator("#discoverWiz").isVisible(), true);
    assert.equal(await page.locator("#discoverHue").isVisible(), false);
    await page.locator('[data-fixture-brand="govee"]').click();
    await page.locator(".goveeSetup > summary").waitFor({ state: "visible" });
    assert.match(await page.locator(".goveeSetup").innerText(), /LAN Control/);
    const goveeNotice = await page.locator(".goveeSetup").innerText();
    assert.match(goveeNotice, /Features depend on your fixture and firmware/);
    assert.match(goveeNotice, /app animation cannot be recreated/);
    assert.doesNotMatch(goveeNotice, /ALPHA/);
    assert.equal(await page.locator("#discoverGovee").isVisible(), true);
    await page.locator('[data-fixture-brand="hue"]').click();
    assert.equal(await page.locator("#fixtureLightIdField").isVisible(), true);
    assert.equal(await page.locator(".goveeSetup").isVisible(), false);
    await page.locator('[data-fixture-brand="govee"]').click();
    await page.locator(".goveeSetup > summary").click();
    assert.equal(await page.locator("#discoverGovee").isVisible(), false);
    await page.locator(".goveeSetup > summary").click();
    assert.equal(
      await page
        .locator("#fixtureEnabled")
        .evaluate((input) => getComputedStyle(input).borderRadius),
      "14px",
    );
    await page.locator("#fixtureRows").filter({ hasText: "NOT CONFIGURED" }).waitFor();
    assert.ok(apiRequests.includes("/api/presentation/theme"));
    assert.ok(apiRequests.includes("/api/presentation/navigation"));
    assert.deepEqual(
      apiRequests.filter(
        (url) =>
          ![
            "/api/request-intake",
            "/api/presentation/theme",
            "/api/presentation/navigation",
            "/api/presentation/dashboard",
            "/api/presentation/setup",
            "/api/dashboard",
            "/api/control-deck/state",
            "/api/control-deck/style-profiles",
            "/api/control-deck",
            "/api/control-deck/catalog",
          ].includes(url),
      ),
      ["/system/status", "/lighting-profiles", "/system/update/status"],
    );
    await page.locator('[data-tab="lights"]').click();
    await page.locator('[data-light-tab="control"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator('[data-light-tab="viewer"]').getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await page.locator('[data-light-panel="viewer"]').isVisible(), true);
    assert.match(await page.locator("#lightWorkspaceHelp").textContent(), /Channel Points/);
    await page.keyboard.press("Home");
    assert.equal(await page.locator('[data-light-panel="control"]').isVisible(), true);
    assert.equal(await page.locator("#controlRoutingTestInput").isVisible(), true);
    const swatch = await page.locator('.swatchRow [data-color="red"]').boundingBox();
    assert(
      swatch && Math.abs(swatch.width - swatch.height) <= 1,
      "original color presets stay square",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }

  const page = await browser.newPage();
  const update = {
    ok: true,
    currentVersion: "0.8",
    latest: { version: "99.0", available: true },
    checkOnLaunch: false,
    hosted: true,
    canRestart: false,
  };
  await page.route("**/system/update/status", (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: "updates_unavailable" } }),
  );
  await page.route("**/system/update/check", (route) => route.fulfill({ json: update }));
  let downloads = 0;
  let installs = 0;
  await page.route("**/system/update/download", (route) => {
    downloads++;
    if (downloads === 1)
      return route.fulfill({ status: 503, json: { ok: false, error: "network_unavailable" } });
    return route.fulfill({ json: { ...update, staged: { version: "99.0", verified: true } } });
  });
  await page.route("**/system/update/apply", (route) => {
    installs++;
    return route.fulfill({ json: { ...update, operation: { phase: "preparing" } } });
  });
  await page.goto(url);
  await page.locator("#health").filter({ hasText: "Online" }).waitFor();
  await page.locator('[data-tab="fixtures"]').click();
  await page.locator("#fixtureRows").filter({ hasText: "NOT CONFIGURED" }).waitFor();
  await page.locator("#moreNav > summary").click();
  await page.locator('[data-tab="features"]').click();
  await page.locator("#updateStatus").filter({ hasText: "Unavailable" }).waitFor();
  await page.locator("#checkForUpdate").click();
  await page.locator("#updateStatus").filter({ hasText: "Launcher update required" }).waitFor();
  assert.equal(await page.locator("#updateInstaller").isVisible(), true);
  assert.equal(await page.locator("#downloadUpdate").isHidden(), true);
  assert.equal(await page.locator("#applyUpdate").isHidden(), true);
  update.canRestart = true;
  await page.locator("#checkForUpdate").click();
  await page.locator("#updateStatus").filter({ hasText: "Update available" }).waitFor();
  await page.locator("#downloadUpdate").click();
  await page.locator("#updateNotice").filter({ hasText: "Could not finish the update." }).waitFor();
  await page.locator("#downloadUpdate").click();
  await page.locator("#updateStatus").filter({ hasText: "Preparing" }).waitFor();
  assert.equal(downloads, 2);
  assert.equal(installs, 1);
  await page.close();
});

test("Viewer controls exposes and saves Rave permission without granting audio or starting lights", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-viewer-rave-"));
  const { app, services } = createCoreServer({ runtimeDir, dryRun: true });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    const relative = path.relative(os.tmpdir(), runtimeDir);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  await services.musicToLight.call({
    capability: "music.styles.v1",
    method: "configure",
    payload: {
      ...services.musicToLight.view().design,
      intensity: 0.43,
      warmCoolColors: true,
    },
  });
  const before = services.musicToLight.view();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator('[data-tab="lights"]').click();
  await page.locator('[data-light-tab="viewer"]').click();
  await page.locator('[data-viewer-section="rave"]').click();
  await page.waitForFunction(() => !document.getElementById("viewerRaveEnabled").disabled);
  assert.equal(await page.locator("#viewerRaveEnabled").isChecked(), false);
  await page
    .locator("label")
    .filter({ has: page.locator("#viewerRaveEnabled") })
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("viewerRaveEnabled").checked &&
      !document.getElementById("viewerRaveEnabled").disabled,
  );
  assert.equal(services.musicToLight.view().design.raveEnabled, true);
  assert.equal(services.musicToLight.view().design.intensity, before.design.intensity);
  assert.equal(services.musicToLight.view().design.warmCoolColors, true);
  assert.deepEqual(services.musicToLight.view().status.permissions, before.status.permissions);
  assert.equal(services.musicToLight.view().status.session, null);
  assert.match(await page.locator("#viewerRaveStatus").textContent(), /audio|Dynamic|music/i);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-tab="lights"]').click();
  await page.locator('[data-light-tab="viewer"]').click();
  await page.locator('[data-viewer-section="rave"]').click();
  await page.waitForFunction(() => !document.getElementById("viewerRaveEnabled").disabled);
  assert.equal(await page.locator("#viewerRaveEnabled").isChecked(), true);
  await page
    .locator("label")
    .filter({ has: page.locator("#viewerRaveEnabled") })
    .click();
  await page.waitForFunction(() => !document.getElementById("viewerRaveEnabled").disabled);
  assert.equal(services.musicToLight.view().design.raveEnabled, false);
  await page.locator("#viewerRaveSetup").click();
  assert.equal(await page.locator('[data-light-panel="music"]').isVisible(), true);
  assert.equal(await page.locator('[data-music-view="setup"]').isVisible(), true);
  assert.deepEqual(errors, []);
});
