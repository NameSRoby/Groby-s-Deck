const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { chromium } = require("playwright");
test("soundboard uploads and creates editable deck macros without playing on save; Mods lives under Packages", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-sound-ui-")),
    calls = [];
  const created = require("../src/app/core/create-core-server")({
    rootDir: path.resolve(__dirname, ".."),
    runtimeDir: root,
    dryRun: true,
    capabilities: { mods: true },
    controlDeckDesktopOptions: {
      platform: "win32",
      request: async (operation, payload) => {
        calls.push({ operation, payload });
        if (operation === "soundboard.status")
          return {
            available: true,
            outputs: [
              { key: "device:" + "a".repeat(64), name: "Headphones" },
              { key: "device:" + "b".repeat(64), name: "CABLE Input (VB-Audio Virtual Cable)" },
            ],
            inputs: [{ name: "CABLE Output (VB-Audio Virtual Cable)" }],
            playing: [],
          };
        return { available: false, devices: [], apps: [] };
      },
    },
  });
  const initial = created.services.controlDeck.snapshot();
  initial.config.mode = "deck";
  initial.config.pages = [{ id: "main", name: "Main", buttons: [] }];
  created.services.controlDeck.save(initial.config, initial.revision);
  const server = await new Promise((resolve) => {
      const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
    }),
    browser = await chromium.launch({ headless: true }),
    page = await browser.newPage({ viewport: { width: 1426, height: 1000 } }),
    base = "http://127.0.0.1:" + server.address().port;
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await created.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
  await page.goto(base);
  await page.locator("#deckAddButton").click();
  await page.locator("#deckButtonName").fill("Native alert");
  await page.locator('[data-deck-action="native.soundboard.play"]').click();
  await page.getByLabel("Choose audio file", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-deck-parameter="volume"]').isVisible(), false);
  assert.equal(await page.locator(".deckStepParameters > textarea").count(), 0);
  const inlineWave = Buffer.alloc(44);
  inlineWave.write("RIFF");
  inlineWave.write("WAVE", 8);
  await page
    .getByLabel("Choose audio file", { exact: true })
    .setInputFiles({ name: "Alert.wav", mimeType: "audio/wav", buffer: inlineWave });
  await page.locator(".deckSoundFile [role=status]").filter({ hasText: "Ready" }).waitFor();
  const outputs = page.locator("#deckEditor .deckSoundOutputs");
  await outputs.getByLabel("Headphones", { exact: true }).check();
  await outputs
    .getByLabel("Virtual mic: CABLE Output (VB-Audio Virtual Cable)", { exact: true })
    .check();
  await outputs.getByLabel("Windows default output", { exact: true }).uncheck();
  await page.locator("#deckSaveButton").click();
  await page.locator("#deckEditor").waitFor({ state: "hidden" });
  const native = created.services.controlDeck.snapshot().config.pages[0].buttons[0];
  assert.equal(native.steps[0].actionId, "native.soundboard.play");
  assert.deepEqual(native.steps[0].params.outputs, [
    "device:" + "a".repeat(64),
    "device:" + "b".repeat(64),
  ]);
  assert.equal(native.steps[0].params.volume, 80);
  assert.equal(
    calls.some((row) => row.operation === "soundboard.play"),
    false,
  );
  await page.locator("#moreNav > summary").click();
  await page.locator('[data-tab="soundboard"]').click();
  const wave = Buffer.alloc(1644);
  wave.write("RIFF");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(1600, 40);
  await page.waitForFunction(
    () =>
      !document.getElementById("soundboardUpload").disabled &&
      document.getElementById("soundboardStatus").textContent.includes("sounds"),
  );
  await page
    .locator("#soundboardUpload")
    .setInputFiles({ name: "Boop.wav", mimeType: "audio/wav", buffer: wave });
  try {
    await page.getByRole("button", { name: "Add deck button", exact: true }).last().waitFor();
  } catch (error) {
    throw Error((await page.locator("#soundboardNotice").textContent()) + " / " + error.message);
  }
  await page.locator("#soundboardOutputChoices").getByLabel("Headphones").check();
  await page
    .locator("#soundboardOutputChoices")
    .getByLabel("Virtual mic: CABLE Output (VB-Audio Virtual Cable)", { exact: true })
    .check();
  await page.locator("#soundboardOutputChoices").getByLabel("Windows default output").uncheck();
  await page.locator("#soundboardVolume").fill("35");
  await page.locator("#soundboardMode").selectOption("toggle");
  await page.getByRole("button", { name: "Add deck button", exact: true }).last().click();
  await page.locator("#soundboardNotice").filter({ hasText: "Added Boop" }).waitFor();
  const deck = (await (await fetch(base + "/api/control-deck")).json()).value.config;
  const button = deck.pages.find((p) => p.name === "Soundboard").buttons[0];
  assert.equal(button.steps[0].actionId, "native.soundboard.play");
  assert.deepEqual(button.steps[0].params.outputs, [
    "device:" + "a".repeat(64),
    "device:" + "b".repeat(64),
  ]);
  assert.equal(button.steps[0].params.volume, 35);
  assert.equal(button.steps[0].params.mode, "toggle");
  assert.equal(
    calls.some((row) => row.operation === "soundboard.play"),
    false,
  );
  await page.getByRole("button", { name: "Rename", exact: true }).last().click();
  await page.locator("#soundboardName").fill("Ping");
  await page.locator("#soundboardRenameSave").click();
  await page.locator("#soundboardRows").filter({ hasText: "Ping" }).waitFor();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await page.locator("#soundboardRemoveConfirm").click();
  await page.waitForFunction(
    () => !document.getElementById("soundboardRows").textContent.includes("Ping"),
  );
  await page.locator("#moreNav > summary").click();
  await page.locator("#featuresTab").click();
  assert.equal(await page.locator("#modsTab").count(), 0);
  await page.locator("#modsSectionTab").click();
  assert.equal(await page.locator("#modRows").isVisible(), true);
  assert.equal(await page.locator("#coreUpdates").isVisible(), false);
  await page.getByRole("tab", { name: "Updates & packages", exact: true }).click();
  assert.equal(await page.locator("#coreUpdates").isVisible(), true);
  assert.deepEqual(errors, []);
});
