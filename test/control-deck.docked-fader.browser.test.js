/** Reproduce a dense desktop button deck with a docked synthetic app fader. */
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright"),
  createCore = require("../src/app/core/create-core-server");
test("docked fader is centered beside the button grid, with a slim rail and a broad touch surface", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-docked-fader-"));
  const empty = { type: "object", properties: {}, additionalProperties: false };
  const core = createCore({
    runtimeDir,
    dryRun: true,
    desktopActions: {
      catalog: () => [
        {
          id: "native.demo",
          label: "Demo action",
          group: "Demo",
          symbol: "◆",
          available: true,
          parameters: empty,
        },
        {
          id: "native.demo-volume",
          label: "TIDALPlayer volume",
          group: "Demo",
          symbol: "◕",
          available: true,
          state: 25,
          parameters: {
            type: "object",
            properties: { level: { type: "integer", minimum: 0, maximum: 100 } },
            required: ["level"],
            additionalProperties: false,
          },
          control: { type: "slider", parameter: "level", min: 0, max: 100, step: 1 },
        },
      ],
      execute: async () => ({ ok: true }),
      integrations: async () => ({}),
      shutdown: async () => {},
    },
  });
  const names = [
    "Main",
    "Main 2",
    "Camera",
    "Face zoom",
    "Media",
    "Game",
    "Handheld",
    "Cooking",
    "Clip broadcast",
    "Timestamp",
    "Auto-Rave",
    "Skip request",
    "Ban song",
    "Ban requester",
    "Rewards",
    "Microphone",
    "Deafen",
    "Mood",
    "Off",
    "Streaming",
    "Rave",
    "Previous song",
    "Playback",
    "Next song",
    "Request mode",
    "Camera scenes",
  ];
  const config = {
    version: 1,
    mode: "deck",
    columns: 8,
    layout: { sliderPlacement: "dock", sliderOrientation: "vertical", sliderStyle: "mixer" },
    pages: [
      {
        id: "main",
        name: "Quick Access",
        buttons: [
          ...names.map((title, index) => ({
            id: "demo-" + index,
            title,
            kind: "macro",
            steps: [{ actionId: "native.demo", params: {} }],
            appearance: {
              symbol: ["◉", "▣", "◆", "♫"][index % 4],
              color: ["#3f7586", "#69608d", "#a34461", "#348c78"][index % 4],
            },
          })),
          {
            id: "volume",
            title: "TIDALPlayer volume",
            kind: "slider",
            steps: [{ actionId: "native.demo-volume", params: { level: 25 } }],
            appearance: { color: "#a90036" },
          },
        ],
      },
    ],
  };
  core.services.controlDeck.save(config, core.services.controlDeck.snapshot().revision);
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const card = page.locator('#deckSliderRack [data-deck-button="volume"]'),
    grid = page.locator("#deckGrid");
  await card.waitFor();
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(80);
    const box = await card.boundingBox(),
      bank = await grid.boundingBox(),
      input = await card.locator("input[type=range]").boundingBox();
    await page.screenshot({
      path: path.resolve("runtime/deck-slim-desktop-private.png"),
      fullPage: true,
    });
    assert(
      Math.abs(box.y + box.height / 2 - bank.y - bank.height / 2) <= 2,
      "the fader must center on the button bank " + JSON.stringify({ box, bank }),
    );
    assert(input.width >= box.width * 0.8, "the invisible touch surface fills most of the width");
    assert.equal(
      await card.evaluate((node) => getComputedStyle(node).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(80);
  await page.screenshot({
    path: path.resolve("runtime/deck-slim-desktop-private.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
});
