const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  express = require("express"),
  { chromium } = require("playwright");
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-widgets-ui-")),
    app = express();
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: ["user:read:chat", "channel:read:predictions", "channel:manage:redemptions"],
    }),
    refreshSubscriptions() {},
  };
  const service = require("../src/domains/overlays/stream-overlays.service")({
    runtimeDir: root,
    getProvider: () => provider,
  });
  app.use(express.json({ limit: "256kb" }));
  require("../src/app/core/register-stream-overlays.routes")(app, {
    service,
    runtimeDir: root,
    express,
  });
  app.use(express.static(path.resolve(__dirname, "../public/core")));
  const server = await new Promise((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    }),
    browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1426, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(8000);
  t.after(async () => {
    service.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  await page.goto(base + "/overlay-designer.html");
  await page.waitForFunction(async () =>
    (await fetch("/api/stream-overlays").then((r) => r.json())).catalog.some(
      (row) => row.type === "wheel",
    ),
  );
  const add = async (name) => {
    await page.locator("#add").click();
    await page.locator("#widgetCatalog").getByRole("button", { name, exact: true }).click();
  };
  return { page, service, add, base, browser };
}
test("wheel, bingo and voting can be tested as unsaved drafts, then controlled live after saving", async (t) => {
  const { page, service, add } = await setup(t);
  await add("Wheel of names");
  await page.locator("#previewSource").selectOption("sample");
  await page.getByLabel("Spin duration (seconds)").fill("1");
  await page.getByLabel("Spin duration (seconds)").press("Tab");
  await page.getByRole("button", { name: "Spin wheel", exact: true }).click();
  await page.locator("#canvas").getByText("Spinning...", { exact: true }).waitFor();
  assert.equal(service.store.snapshot().documents.length, 0);
  await page
    .locator("#canvas")
    .getByText(/^Selected:/)
    .waitFor();
  await add("Bingo board");
  await page.getByLabel("Board size").selectOption("3");
  assert.equal(await page.getByLabel(/^Bingo text /).count(), 9);
  assert.equal(await page.getByLabel("Bingo text 5", { exact: true }).isDisabled(), true);
  await page.getByLabel("Free center square (odd-sized boards)").uncheck();
  assert.equal(await page.getByLabel("Bingo text 5", { exact: true }).isDisabled(), false);
  await page.getByLabel("Free center square (odd-sized boards)").check();
  await page.getByLabel("Bingo square to mark").fill("1");
  await page.getByRole("button", { name: "Toggle square", exact: true }).click();
  assert.equal(await page.locator(".bingoCell.marked").count(), 2);
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const doc = service.store.snapshot().documents[0];
  assert.equal(doc.widgets.length, 2);
  await page.locator("#previewSource").selectOption("live");
  await page.getByRole("button", { name: "Toggle square", exact: true }).click();
  assert.equal((await service.data()).games[doc.id][doc.widgets[1].id].marks[0], 0);
  await add("Chat voting");
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Start vote", exact: true }).click();
  service.receive("channel.chat.message", {
    broadcaster_user_id: "123",
    chatter_user_id: "999",
    message: { text: "!vote 2" },
  });
  await page.locator("#canvas").getByText("1 votes", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close vote", exact: true }).click();
  await page.locator("#canvas").getByText("Voting closed", { exact: true }).waitFor();
});

test("alignment guides snap a dragged edge with editor-only safe margins", async (t) => {
  const { page, service } = await setup(t);
  service.save({
    expectedRevision: 0,
    document: {
      widgets: [
        { id: "moving", type: "text", x: 80, y: 150, width: 100, height: 75 },
        { id: "anchor", type: "text", x: 503, y: 150, width: 200, height: 75 },
      ],
    },
  });
  await page.reload();
  await page.locator("#canvasOptions").click();
  await page.getByLabel("Show safe margins (editor only)").check();
  await page.locator('[data-close="canvasDialog"]').click();
  await page.locator(".overlaySafeMargins").waitFor();
  const layer = page.locator('[data-widget-id="moving"]');
  const rect = await layer.boundingBox();
  const scale = rect.width / 100;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 321 * scale, rect.y + rect.height / 2, {
    steps: 4,
  });
  await page.locator(".overlayAlignGuide.vertical").waitFor();
  assert.equal(await layer.evaluate((node) => node.style.left), "403px");
  await page.mouse.up();
  assert.equal(await page.locator(".overlayAlignGuide.vertical").isHidden(), true);
  await page.locator("#preview").click();
  assert.equal(await page.locator(".overlaySafeMargins").isHidden(), true);
});
test("schedule rows and record source controls remain editable; every added widget uses shared OBS rendering", async (t) => {
  const { page, add, service, browser, base } = await setup(t);
  await add("Stream schedule");
  await page.getByRole("button", { name: "Add schedule entry", exact: true }).click();
  await page.getByLabel("Stream title 2", { exact: true }).fill("Weekend games");
  await page.getByLabel("Stream title 2", { exact: true }).press("Tab");
  await page.getByLabel("Day 2", { exact: true }).selectOption("5");
  await page.getByLabel("Schedule timezone (for example Europe/Lisbon)").fill("Europe/Lisbon");
  await page.getByLabel("Schedule timezone (for example Europe/Lisbon)").press("Tab");
  await page.locator("#canvas").getByText("Weekend games", { exact: true }).waitFor();
  await add("Leaderboard");
  await page.getByLabel("Leaderboard source").selectOption("watchtime");
  assert.equal(
    await page.getByLabel("Saved stat name (for example xp or wins)").isDisabled(),
    true,
  );
  await page.getByLabel("Leaderboard source").selectOption("stats");
  assert.equal(
    await page.getByLabel("Saved stat name (for example xp or wins)").isDisabled(),
    false,
  );
  const rendering = await page.evaluate(() => {
    const types = [
      "prediction",
      "redemptions",
      "leaderboard",
      "player-card",
      "counter",
      "schedule",
      "chat-vote",
      "wheel",
      "bingo",
      "soundboard",
    ];
    return types.map((type) => {
      const host = document.createElement("div"),
        w = OverlayModel.widget({ id: type, type });
      OverlayRenderer.render(
        host,
        OverlayModel.document({ widgets: [w] }),
        OverlayRenderer.samples(),
      );
      return { type, visible: !!host.textContent.trim() };
    });
  });
  assert.deepEqual(
    rendering.filter((row) => !row.visible),
    [],
  );
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + service.store.snapshot().documents[0].id);
  await output.locator("#output").getByText("Weekend games", { exact: true }).waitFor();
  assert.equal(
    await output.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
});

test("hand tool pans a zoomed canvas without moving widgets or changing undo state", async (t) => {
  const { page, add } = await setup(t);
  await add("Text");
  await page.locator("#zoom").selectOption("1.5");
  await page.locator("#panCanvas").click();
  const original = await page
    .locator("#canvas .overlayLayer")
    .evaluate((node) => [node.style.left, node.style.top]);
  const box = await page.locator("#stageWrap").boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.locator("#stageWrap").evaluate((node) => node.scrollLeft > 50));
  assert.deepEqual(
    await page
      .locator("#canvas .overlayLayer")
      .evaluate((node) => [node.style.left, node.style.top]),
    original,
  );
  await page.locator("#undo").click();
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 0);
});

test("widget category and search filters keep the picker compact and preserve access hints", async (t) => {
  const { page } = await setup(t);
  await page.locator("#add").click();
  await page.locator("#widgetGroup").selectOption("Games");
  assert.equal(await page.locator("#widgetCatalog button").count(), 3);
  await page.locator("#widgetSearch").fill("wheel");
  assert.equal(await page.locator("#widgetCatalog button").count(), 1);
  await page.locator("#widgetSearch").fill("");
  await page.locator("#widgetGroup").selectOption("Twitch");
  await page
    .locator("#widgetCatalog")
    .getByRole("button", { name: "Twitch Predictions", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("#catalogDialog")
      .evaluate((node) => node.scrollHeight > node.clientHeight + 2),
    false,
  );
});

test("the full widget catalog keeps titles and permission hints inside scrollable cards", async (t) => {
  const { page } = await setup(t);
  await page.locator("#add").click();
  const catalog = page.locator("#widgetCatalog");
  await catalog.locator("small").first().waitFor();
  for (const viewport of [
    { width: 1920, height: 960 },
    { width: 1280, height: 600 },
    { width: 600, height: 320 },
    { width: 390, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const clipped = await catalog.evaluate((node) =>
      [...node.querySelectorAll("button")].flatMap((button) => {
        const bounds = button.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(button);
        return [...text.getClientRects()].some(
          (rect) => rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1,
        )
          ? [button.textContent]
          : [];
      }),
    );
    assert.deepEqual(
      clipped,
      [],
      `clipped catalog cards at ${viewport.width} × ${viewport.height}`,
    );
  }
  await catalog.evaluate((node) => (node.scrollTop = node.scrollHeight));
  assert.ok((await catalog.evaluate((node) => node.scrollTop)) > 0);
  await page.locator("#widgetSearch").fill("no matching fixture");
  await catalog.getByText("No matching widgets.").waitFor();
  await page.locator("#widgetSearch").fill("text");
  assert.equal(await catalog.evaluate((node) => node.scrollTop), 0);
  await catalog.getByRole("button", { name: "Text", exact: true }).click();
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 1);
});
