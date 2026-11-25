const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium, firefox } = require("playwright");
const createCore = require("../src/app/core/create-core-server");
const createExtension = require("../src/app/optional/create-feature-platform-extension");
const derive = require("../public/core/presentation-colors");
const rgb = (hex) =>
  "rgb(" + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ") + ")";

test("the legacy default palette migrates while custom surfaces and readable accent text remain explicit", () => {
  const old = { bg: "#050507", surface: "#121a2f", accent: "#8b001f", text: "#eaeaea", glow: 65 };
  assert.equal(derive(old).surface, "#19191f");
  assert.equal(derive({ ...old, glow: 24 }).surface, "#121a2f");
  assert.equal(derive({ ...old, accent: "#eeee22" })["accent-text"], "#08080b");
  assert.equal(derive(old)["accent-text"], "#ffffff");
});

for (const engine of [chromium, firefox])
  test(`${engine.name()}: palettes cover Core, feature frames and standalone tools; outside clicks dismiss surfaces`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-theme-surfaces-"));
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
        allowUnsafeRuntime: true,
        providers: {
          "spotify.desktop.host.v1/status": () => ({
            ok: true,
            connected: false,
            ready: false,
            installation: { prepared: true },
            capacity: { limit: 10, queued: 0 },
            handoffs: [],
          }),
        },
      }),
    });
    await created.extension.startup;
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const browser = await engine.launch({ headless: true });
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
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://www.youtube.com/**", (route) => route.abort());
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="feature:song-request"]').click();
    await page
      .locator('[data-panel="feature:song-request"]')
      .getByRole("button", { name: "Now Playing Sources", exact: true })
      .click();
    const sources = page
      .frameLocator('iframe[data-page-id="now-playing"]')
      .frameLocator("#surface");
    await sources.locator('.sourceCard[aria-pressed="true"]').waitFor();
    await page.locator("#themeButton").click();
    let palette;
    for (const preset of [
      "midnight",
      "ember",
      "ocean",
      "matrix",
      "aurora",
      "solar",
      "slate",
      "rosewood",
      "forest",
      "graphite",
      "violet",
      "ice",
      "copper",
      "cobalt",
    ]) {
      await page.locator(`[data-theme="${preset}"]`).click();
      palette = derive(
        await page.evaluate(() => JSON.parse(localStorage.getItem("ravelink.hud.theme"))),
      );
      assert.equal(
        await page.locator("#themePanel").evaluate((el) => getComputedStyle(el).backgroundColor),
        rgb(palette.panel),
        preset,
      );
      assert.equal(
        await page.locator("#themeButton").evaluate((el) => getComputedStyle(el).borderColor),
        rgb(palette.edge),
        preset,
      );
      assert.equal(
        await page.locator(`[data-theme="${preset}"]`).getAttribute("aria-pressed"),
        "true",
      );
      await page.waitForFunction(
        (expected) =>
          getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ===
          expected,
        palette.accent,
      );
      await sources.locator('.sourceCard[aria-pressed="true"]').evaluate(
        (el, expected) =>
          new Promise((resolve, reject) => {
            let count = 0;
            const check = () => {
              if (getComputedStyle(el).borderTopColor === expected) resolve();
              else if (++count > 120) reject(Error("Source card ignored theme"));
              else requestAnimationFrame(check);
            };
            check();
          }),
        rgb(palette.accent),
      );
      assert.equal(
        await sources
          .locator(".section")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        rgb(palette.panel),
      );
      assert.equal(
        await page
          .locator("#lightingRoomMap")
          .evaluate((el) => getComputedStyle(el).borderTopColor),
        rgb(palette.edge),
      );
    }
    await page.locator("h1").click();
    assert.equal(await page.locator("#themePanel").isVisible(), false);
    await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.className = "deckGrid";
      fixture.id = "hoverFixture";
      fixture.style.cssText =
        "position:fixed;left:20px;top:160px;width:160px;height:150px;z-index:100";
      const button = document.createElement("button");
      button.className = "deckButton";
      button.textContent = "Custom green";
      button.style.setProperty("--deck-color", "#16a070");
      button.style.setProperty("--deck-backlight", "0.6");
      fixture.append(button);
      document.body.append(fixture);
    });
    await page.locator("#hoverFixture button").hover();
    await page.waitForFunction(
      (expected) =>
        getComputedStyle(document.querySelector("#hoverFixture button")).borderTopColor ===
        expected,
      rgb("#16a070"),
    );
    assert.equal(
      await page
        .locator("#hoverFixture button")
        .evaluate((el) => getComputedStyle(el).borderTopColor),
      rgb("#16a070"),
    );
    await page.locator("#hoverFixture").evaluate((el) => el.remove());
    await page.locator('[data-tab="feature:song-request"]').click();
    const feature = page
      .locator('[data-panel="feature:song-request"] iframe[data-page-id="player"]')
      .contentFrame()
      .locator("#surface")
      .contentFrame();
    await page
      .locator('[data-panel="feature:song-request"]')
      .getByRole("button", { name: "Player", exact: true })
      .click();
    await feature
      .locator(
        '[data-choice-for="songPlayerProvider"] [data-choice-value="spotify"]:not([disabled])',
      )
      .click();
    await feature.locator("#spotifyOpenSetup").click();
    await feature.locator("#spotifyLaunch:not([disabled])").waitFor();
    assert.equal(
      await feature.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb(palette.panel),
    );
    await feature.locator("#spotifyLaunch").hover();
    assert.equal(
      await feature.locator("#spotifyLaunch").evaluate((el) => getComputedStyle(el).borderColor),
      rgb("#1ed760"),
    );
    assert.doesNotMatch(
      await feature.locator("#spotifyLaunch").evaluate((el) => getComputedStyle(el).boxShadow),
      /139, 0, 31/,
    );
    await page.locator("#themeButton").click();
    await feature.locator("#spotifySetup h2").first().click();
    await page.locator("#themePanel").waitFor({ state: "hidden" });
    await feature.locator("body").evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.id = "dismissFixture";
      dialog.innerHTML = "<p>Draft settings</p><button>Keep editing</button>";
      dialog.style.cssText = "position:fixed;inset:20px auto auto 20px;margin:0";
      document.body.append(dialog);
      dialog.showModal();
    });
    await page.locator("h1").click();
    await feature.locator("#dismissFixture").waitFor({ state: "hidden" });
    await page.locator('[data-tab="feature:twitch-integration"]').click();
    const twitch = page
      .locator('[data-panel="feature:twitch-integration"] iframe')
      .contentFrame()
      .locator("#surface")
      .contentFrame();
    await twitch.locator(".native-feature").waitFor({ state: "attached" });
    assert.equal(
      await twitch.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb(palette.panel),
    );
    const editor = await browser.newPage();
    await editor.goto(base + "/overlay-designer.html");
    await editor.waitForFunction(
      (expected) =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === expected,
      palette.bg,
    );
    assert.equal(
      await editor.locator("html").evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb(palette.bg),
    );
    assert.equal(
      await editor.locator(".layersPanel").evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb(palette.panel),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(
      await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--surface").trim()),
      palette.surface,
    );
    assert.deepEqual(errors, []);
  });
