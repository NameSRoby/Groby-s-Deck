const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { setTimeout: pause } = require("node:timers/promises");
const { chromium } = require(process.env.GROBY_QA_PLAYWRIGHT || "../../node_modules/playwright");

async function until(work, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const ready = await work();
      if (ready) return ready;
    } catch {}
    await pause(125);
  }
  throw Error("Timed out waiting for " + label);
}
async function main() {
  const root = path.resolve(process.argv[2]);
  const skipSong = process.argv.includes("--skip-song");
  const nativeHost = process.argv.includes("--native-host");
  const deep = process.argv.includes("--review-every-preset");
  const everySurface = process.argv.includes("--every-surface");
  const reserve = net.createServer().listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const base = "http://127.0.0.1:" + port;
  const runtime = path.join(root, "runtime", "Grobys-Deck-Node.exe");
  const launcher = path.join(root, "Groby's Deck.exe");
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", RAVELINK_ALLOW_UNSAFE_FEATURE_RUNTIME: "0" };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  if (process.platform === "win32") {
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.Path = ["System32", "", "System32/Wbem", "System32/WindowsPowerShell/v1.0"]
      .map((part) => path.join(process.env.WINDIR, part)).join(";");
  }
  let logs = "";
  const entry = path.join(root, "src/app/optional/feature-enabled-server.js");
  const child = spawn(nativeHost ? launcher : runtime, nativeHost ? ["--background"] : [entry], {
    cwd: os.tmpdir(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  child.stdout.on("data", (part) => logs += part);
  child.stderr.on("data", (part) => logs += part);
  let browser;
  const errors = [];
  const api = async (url) => {
    const response = await fetch(base + url, { signal: AbortSignal.timeout(2500) });
    assert.equal(response.status, 200, url);
    return response.json();
  };
  try {
    await until(() => api("/health"), "Core health");
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500)
        errors.push(response.status() + " " + new URL(response.url()).pathname);
    });
    await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator('[data-tab="feature:twitch-integration"]').waitFor();
    if (!skipSong) await page.locator('[data-tab="feature:song-request"]').waitFor();
    const features = await until(async () => {
      const { features } = await api("/api/features");
      return features.filter((feature) => feature.lifecycle === "active").length === (skipSong ? 1 : 2) && features;
    }, "bundled features");
    assert.equal(features.find((f) => f.id === "twitch-integration").version, "0.12.70");
    assert.equal(features.some((f) => f.id === "song-request"), !skipSong);
    if (!skipSong) assert.equal(features.find((f) => f.id === "song-request").version, "0.45.32");
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).releaseVersion, "0.8.2c");
    await page.locator('html[data-workspace-profile="normal"]').waitFor();
    const gameConfig = await api("/api/stream-overlays/game-commands");
    assert.equal(gameConfig.enabled, false);
    assert.deepEqual(gameConfig.commands.find((command) => command.id === "complete").roles, ["moderator"]);

    const mods = await api("/api/mod-platform");
    assert.ok(mods.inbox.candidates.some((c) => c.id === "groby.twitch-clips" && c.valid));
    assert.equal(mods.mods.length, 0);
    const deck = (await api("/api/control-deck/catalog")).value;
    assert.equal(deck.presets.length, 31);
    assert.ok(deck.presets.every((preset) => preset.public));
    assert.equal((await api("/lighting-profiles")).profiles.filter((p) => p.public).length, 7);
    assert.equal((await api("/api/control-deck/style-profiles")).value.profiles.filter((p) => p.public).length, 10);
    assert.equal(await page.locator("[data-theme]").count(), 14);
    const music = await api("/api/music-to-light/catalog");
    assert.equal(music.ok, true);
    await page.locator('[data-tab="feature:twitch-integration"]').click();

    const connection = page.frameLocator('iframe[data-page-id="connection"]').frameLocator("#surface");
    await connection.locator("#permissionCount").filter({ hasText: "selected" }).waitFor();
    await page.locator("#themeButton").click();
    await page.locator("#customizeTabs").click();
    await page.getByRole("radio", { name: "Compact", exact: true }).click();
    await connection.locator('html[data-workspace-profile="compact"]').waitFor();
    assert.equal(await connection.locator("body").evaluate((node) => getComputedStyle(node).fontSize), "13px");
    await page.locator("#closeNavigation").click();
    await connection.locator('html[data-workspace-profile="normal"]').waitFor();

    await page.getByRole("button", { name: "Rewards & automations", exact: true }).click();
    const frame = page.frameLocator('iframe[data-page-id="automations"]').frameLocator("#surface");
    await frame.locator("#notice").filter({ hasText: "Ready." }).waitFor();
    assert.equal(await frame.locator("#commandExamples").isVisible(), true);
    assert.equal(await frame.locator("#commandExamples option").count(), 116);
    await frame.getByRole("button", { name: "Built-in features", exact: true }).click();
    assert.equal(await frame.locator(".automationItem").count(), 4);
    assert.equal(await frame.getByText("Enable Song Request in Packages", { exact: true }).count(), skipSong ? 2 : 0);
    await frame.getByRole("button", { name: "Channel Points", exact: true }).click();
    assert.equal(await frame.locator(".automationItem").count(), 0);
    if (deep) {
      const examples = await frame.locator("#commandExamples option").evaluateAll((options) => options.map((o) => o.value));
      assert.equal(new Set(examples).size, examples.length);
      for (const example of examples) {
        await frame.locator("#commandExamples").selectOption(example);
        await frame.locator("#useCommandExample").click();
        assert.ok(await frame.locator("#name").inputValue(), example);
        assert.equal(await frame.locator("#save").isDisabled(), true, example);
      }
      console.log("Opened all " + examples.length + " automation drafts before account setup.");
    }
    await frame.locator("#commandExamples").selectOption("fight");
    await frame.locator("#useCommandExample").click();
    assert.equal(await frame.locator("#command").inputValue(), "!fight");
    assert.equal(await frame.locator("#save").isDisabled(), true);
    await page.getByRole("button", { name: "Watchtime & points", exact: true }).click();
    const watchtime = page.frameLocator('iframe[data-page-id="watchtime"]').frameLocator("#surface");
    await watchtime.locator('#mode option[value="off"]').waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Quotes", exact: true }).click();
    const quotes = page.frameLocator('iframe[data-page-id="quotes"]').frameLocator("#surface");
    await quotes.getByLabel("Enable quote commands in Twitch chat").waitFor();
    await page.locator('[data-tab="dashboard"]').click();
    await page.locator("#deckButtonMode").click();
    await page.locator("#deckAddButton").click();
    const picker = page.getByLabel("Public button preset", { exact: true });
    await picker.waitFor();
    assert.equal(await picker.locator("option:not(:disabled)").count(), 32);
    if (deep) {
      for (const preset of deck.presets) {
        await picker.selectOption(preset.id);
        assert.equal(await page.locator("#deckButtonName").inputValue(), preset.name);
      }
      console.log("Opened all " + deck.presets.length + " button presets before account setup.");
    }
    await picker.selectOption("clip");
    await page.locator("#deckSaveButton").click();
    await picker.waitFor({ state: "hidden" });
    const { value } = await api("/api/control-deck");
    assert.deepEqual(value.config.pages.flatMap((p) => p.buttons).find((b) => b.title === "Clip the broadcast").steps[0].params, { duration: 30 });
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
    if (everySurface) {
      await page.keyboard.press("Escape");
      await page.locator("#deckSettings").waitFor({ state: "hidden" });
      for (const tab of ["fixtures", "widget", "lights", "soundboard", "overlays", "features"]) {
        const button = page.locator(`[data-tab="${tab}"]`);
        if (!(await button.isVisible())) {
          const menu = page.locator("#moreNav");
          if (!(await menu.evaluate((element) => element.open))) await menu.locator("summary").click();
        }
        await button.click();
        await page.locator(`[data-panel="${tab}"]`).waitFor();
        if (tab === "lights") {
          for (const key of ["control", "viewer", "music", "profiles", "commands", "layout"]) {
            await page.locator(`[data-light-tab="${key}"]`).click();
            await page.locator(`[data-light-panel="${key}"]`).waitFor();
          }
        }
        if (tab === "soundboard") await page.locator("#soundboardUpload").waitFor();
        if (tab === "overlays") {
          const exit = page.frameLocator("#overlayDesignerFrame").locator("#exitStudio");
          await until(() => exit.evaluate((button) => typeof button.onclick === "function"), "Overlay Designer initialization");
          await exit.click();
          await page.locator('[data-panel="dashboard"]').waitFor();
        }
        if (tab === "features") {
          for (const mode of ["mods", "packages"]) await page.locator(`[data-maintenance="${mode}"]`).click();
        }
      }
      const pagesByFeature = {
        "song-request": ["player", "request-queue", "server-playlist", "now-playing", "obs-overlay", "overlay-editor"],
        "twitch-integration": ["connection", "automations", "command-list", "syntax", "quotes", "watchtime"],
      };
      for (const feature of features) {
        assert.deepEqual(feature.uiContributions.map((row) => row.id).sort(), pagesByFeature[feature.id].slice().sort());
        const tab = page.locator(`[data-tab="feature:${feature.id}"]`);
        if (!(await tab.isVisible())) {
          const menu = page.locator("#moreNav");
          if (!(await menu.evaluate((element) => element.open))) await menu.locator("summary").click();
        }
        await tab.click();
        const panel = page.locator(`[data-panel="feature:${feature.id}"]`);
        for (const id of pagesByFeature[feature.id]) {
          await panel.locator(`button[data-page="${id}"]`).click();
          const shell = panel.locator(`iframe[data-page-id="${id}"]`);
          await shell.waitFor();
          const content = panel.frameLocator(`iframe[data-page-id="${id}"]`).frameLocator("#surface");
          await content.locator("head > title").waitFor({ state: "attached" });
          if (id === "player") {
            for (const provider of ["youtube", "tidal", "spotify", "soundcloud"]) {
              await content.locator(`[data-choice-for="songPlayerProvider"] [data-choice-value="${provider}"]`).click();
              await content.locator(`body[data-player-provider="${provider}"]`).waitFor();
              await content.getByRole("tab", { name: "Setup", exact: true }).click();
              await content.getByRole("tab", { name: "Chat Responses", exact: true }).click();
              await content.locator("#responseToggles").waitFor();
              await content.getByRole("tab", { name: "Moderation", exact: true }).click();
              await content.getByRole("tab", { name: "Playback", exact: true }).click();
            }
          }
          console.log("Opened workspace", feature.id, id);
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(fs.existsSync(path.join(root, "runtime", "system", "twitch-intake-pause.json")), false);
    console.log("CLEAN INSTALL PASSED:", path.basename(root), JSON.stringify({ examples: 116, buttonPresets: deck.presets.length, builtins: 4, features: features.map((f) => f.id), clipApproval: false }));
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    await browser?.close();
    if (nativeHost) spawn(launcher, ["--stop"], { env, windowsHide: true, stdio: "ignore" });
    else await fetch(base + "/system/stop", { method: "POST", signal: AbortSignal.timeout(2500) }).catch(() => {});
    const stopped = await Promise.race([exited.then(() => true), pause(7000, false, { ref: false })]);
    if (!stopped) child.kill();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
