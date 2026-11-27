const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  express = require("express"),
  { chromium } = require("playwright");
async function setup(t, getRecords) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-widgets-ui-")),
    app = express();
  const replies = [];
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: [
        "user:read:chat",
        "user:write:chat",
        "channel:read:predictions",
        "channel:manage:redemptions",
      ],
    }),
    refreshSubscriptions() {},
    async sendChat(input) {
      replies.push(input);
    },
  };
  const service = require("../src/domains/overlays/stream-overlays.service")({
    runtimeDir: root,
    getProvider: () => provider,
    ...(getRecords ? { getRecords } : {}),
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
  return { page, service, add, base, browser, provider, replies };
}

test("static scenes stay idle and a burst of pointer events keeps the final widget position", async (t) => {
  const { page, service, base, browser } = await setup(t);
  const saved = service.save({
    expectedRevision: 0,
    document: {
      name: "Static canvas",
      width: 1280,
      height: 720,
      widgets: [
        { id: "label", type: "text", text: "Static", x: 40, y: 40, width: 180, height: 80 },
      ],
    },
  });
  const previewCalls = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/preview-data"))
      previewCalls.push(request.url());
  });
  await page.reload();
  await page.locator("#overlayLibrary > summary").click();
  await page.getByRole("button", { name: /Static canvas/ }).click();
  const layer = page.locator('[data-widget-id="label"]');
  await layer.waitFor();
  assert.equal((await service.presentation(saved.selectedId)).data, null);
  await page.locator("#feedStatus").getByText("No live data needed").waitFor();
  await page.evaluate(() => {
    const render = window.OverlayRenderer.render;
    window.sceneRenders = 0;
    window.OverlayRenderer.render = (...args) => {
      window.sceneRenders++;
      return render(...args);
    };
    document.getElementById("canvas").addEventListener("pointerdown", (event) => {
      window.gesturePointer = event.pointerId;
    });
  });
  const rect = await layer.boundingBox();
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const burstRenders = await page.evaluate(
    ({ x, y }) => {
      const canvas = document.getElementById("canvas"),
        before = window.sceneRenders;
      for (let i = 1; i <= 60; i++)
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: x + i,
            clientY: y,
            pointerId: window.gesturePointer,
            buttons: 1,
          }),
        );
      return window.sceneRenders - before;
    },
    { x, y },
  );
  await page.mouse.up();
  assert.equal(burstRenders, 0);
  assert.ok(Number.parseFloat(await layer.evaluate((node) => node.style.left)) > 90);
  assert.deepEqual(previewCalls, []);

  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + saved.selectedId);
  await output.locator('[data-widget-id="label"]').waitFor();
  const nextPoll = output.waitForResponse((response) => response.url().includes("presentation/"));
  await output.evaluate(() => {
    const render = window.OverlayRenderer.render;
    window.sceneRenders = 0;
    window.OverlayRenderer.render = (...args) => {
      window.sceneRenders++;
      return render(...args);
    };
  });
  await nextPoll;
  assert.equal(await output.evaluate(() => window.sceneRenders), 0);
});

test("trusted Twitch roles control only the chosen game and repeated completion stays marked in OBS", async (t) => {
  const { page, service, base, browser, provider, replies } = await setup(t);
  const saved = service.save({
    expectedRevision: 0,
    document: {
      name: "Games",
      width: 1280,
      height: 720,
      widgets: [
        {
          id: "active",
          name: "Hero wins",
          type: "challenge-board",
          tiles: [
            { id: "hero", text: "First Hero", x: 5, y: 10 },
            { id: "second", text: "Second Hero", x: 55, y: 10 },
          ],
        },
        { id: "other", name: "Other board", type: "bingo" },
        {
          id: "vote",
          name: "Direction",
          type: "chat-vote",
          items: ["Left", "Right"],
          votePrefix: "!goleft",
        },
      ],
    },
  });
  const doc = saved.documents[0];
  await page.locator("#openGameChat").click();
  await page.locator("#gameChatTarget").selectOption(doc.id + "/active");
  await page.locator("#gameChatEnabled").check();
  const vip = page.locator('tr[data-command="uncomplete"]').getByRole("checkbox", { name: /vip$/ });
  await vip.check();
  assert.equal(
    await page.getByText("!complete <square name or number>", { exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.locator('tr[data-command="spin"]').isHidden(), true);
  await page.locator("#saveGameChat").click();
  await page.getByText("Game command permissions saved.").waitFor();
  await page.reload();
  await page.locator("#openGameChat").click();
  await page.getByText("Game commands are enabled for your connected Twitch channel.").waitFor();
  assert.equal(await page.locator("#gameChatTarget").inputValue(), doc.id + "/active");
  assert.equal(await vip.isChecked(), true);
  assert.ok(service.events("123").includes("channel.chat.message"));
  const say = (actor, id, text, badges = [], fields = {}) =>
    service.gameChatHandle(
      {
        broadcaster_user_id: "123",
        chatter_user_id: actor,
        message_id: id,
        message: { text },
        badges: badges.map((set_id) => ({ set_id })),
        ...fields,
      },
      provider,
    );
  assert.equal((await say("222", "denied", "!complete First Hero")).accepted, false);
  assert.equal(
    await say("223", "foreign", "!complete First Hero", ["moderator"], {
      source_broadcaster_user_id: "7",
    }),
    undefined,
  );
  assert.equal((await say("123", "complete-one", "!complete first   hero")).accepted, true);
  assert.equal((await say("223", "complete-again", "!complete #1", ["moderator"])).accepted, true);
  const show = await browser.newPage();
  await show.goto(base + "/stream-overlay.html?id=" + doc.id);
  const marked = show.locator(".extra-challenge-board .bingoCell.marked");
  await marked.getByText("First Hero").waitFor();
  assert.match(replies.at(-1).message, /already complete/);
  assert.equal((await say("224", "uncomplete", "!uncomplete First Hero", ["vip"])).accepted, true);
  await marked.waitFor({ state: "hidden" });
  assert.equal((await say("223", "complete-again", "!complete 1", ["moderator"])).accepted, false);
  const boards = service.bingoDeck({ documentId: doc.id, widgetId: "other" });
  assert.deepEqual(
    boards.board.cells.filter((cell) => cell.marked && !cell.free),
    [],
  );
  service.gameChatConfigure({
    revision: service.gameChatStatus().revision,
    enabled: true,
    target: doc.id + "/vote",
    permissions: { cast_vote: { viewer: false } },
  });
  assert.equal((await say("225", "open-vote", "!openvotes", ["moderator"])).accepted, true);
  for (const [id, text, badges] of [
    ["229", "!goleft 1", []],
    ["230", "!goleft 2", [{ set_id: "vip" }]],
  ]) {
    service.receive("channel.chat.message", {
      broadcaster_user_id: "123",
      chatter_user_id: id,
      message_id: "vote-" + id,
      message: { text },
      badges,
    });
  }
  assert.deepEqual((await service.data({ fast: true })).games[doc.id].vote.counts, [0, 1]);
});
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
test("clicking a canvas tile opens its settings and dragging still moves the whole board", async (t) => {
  const { page, add } = await setup(t);
  await add("Challenge board");
  await page.getByLabel("Tiles per row").fill("12");
  await page.getByLabel("Rows", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply grid size" }).click();
  await page.locator('[data-inspector="style"]').click();

  const layer = page.locator('#canvas [data-widget-type="challenge-board"]');
  const tile = layer.locator('[data-challenge-tile="20"]');
  const position = () => layer.evaluate((node) => node.style.left);
  const before = await position();
  await tile.click();
  const picker = page.getByLabel("Selected tile", { exact: true });
  assert.equal(await picker.inputValue(), "20");
  assert.equal(await position(), before);
  assert.equal(await tile.evaluate((node) => node.matches(".selectedChallengeTile")), true);
  const label = page.getByLabel("Tile label", { exact: true });
  await label.fill("Canvas selection");
  await label.press("Tab");
  assert.equal(await tile.textContent(), "Canvas selection");

  const rect = await tile.boundingBox();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 65, y, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(await position(), before);
  assert.equal(await picker.inputValue(), "20");
});

test("the settings sidebar can be resized, restored across reloads and reset", async (t) => {
  const { page } = await setup(t);
  const divider = page.getByRole("separator", { name: "Resize settings sidebar" });
  const width = () => page.locator("#layersPanel").evaluate((node) => node.offsetWidth);
  const initial = await width();
  const rect = await divider.boundingBox();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await width(), initial + 150);
  await page.reload();
  await divider.waitFor();
  assert.equal(await width(), initial + 150);
  await divider.press("ArrowLeft");
  assert.equal(await width(), initial + 134);
  await divider.dblclick();
  assert.equal(await width(), initial);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await divider.isHidden(), true);
});

test("challenge grid sizes tiles together or individually and restores tiles when expanded", async (t) => {
  const { page, add, service, base, browser } = await setup(t);
  await add("Challenge board");
  const preview = page.locator(".challengeEditor button");
  assert.equal(await preview.count(), 9);
  const sizeGrid = async (columns, rows) => {
    await page.getByLabel("Tiles per row").fill(String(columns));
    await page.getByLabel("Rows", { exact: true }).fill(String(rows));
    await page.getByRole("button", { name: "Apply grid size" }).click();
    assert.equal(await preview.count(), columns * rows);
  };
  await sizeGrid(2, 3);
  const width = page.getByLabel("Width (% of slot)", { exact: true });
  await width.fill("70");
  await page.getByRole("button", { name: "Apply this size to all tiles" }).click();
  assert.deepEqual(
    await preview.evaluateAll((nodes) => nodes.map((node) => node.style.width)),
    Array(6).fill("35%"),
  );
  await preview.nth(1).click();
  const grip = await page.locator(".challengeResize").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 10, grip.y + grip.height / 2 - 8, { steps: 4 });
  await page.mouse.up();
  assert.ok(Number(await width.inputValue()) < 70);
  await width.fill("40");
  await width.press("Tab");
  const image = "https://example.invalid/hero.png";
  await page.getByText("Use an image URL", { exact: true }).filter({ visible: true }).click();
  await page.getByLabel("Tile image URL").fill(image);
  await page.getByLabel("Tile image URL").press("Tab");
  assert.deepEqual(await preview.evaluateAll((nodes) => nodes.map((node) => node.style.width)), [
    "35%",
    "20%",
    "35%",
    "35%",
    "35%",
    "35%",
  ]);

  await sizeGrid(1, 1);
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const [doc] = service.store.snapshot().documents;
  const [widget] = doc.widgets;
  assert.equal(
    service.bingoDeck({ documentId: doc.id, widgetId: widget.id }).board.cells.length,
    1,
  );
  await page.reload();
  await page.locator("#layers .layerRow").first().click();
  await sizeGrid(2, 3);
  await preview.nth(1).click();
  assert.equal(await width.inputValue(), "40");
  assert.equal(await preview.nth(1).locator("img").getAttribute("src"), image);
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  const cells = output.locator(".extra-challenge-board .bingoCell");
  await cells.nth(5).waitFor();
  assert.deepEqual(await cells.evaluateAll((nodes) => nodes.map((node) => node.style.width)), [
    "35%",
    "20%",
    "35%",
    "35%",
    "35%",
    "35%",
  ]);
  assert.equal(await cells.nth(1).locator("img").getAttribute("src"), image);
});
test("board designer saves images, custom marks, announcements and freeform geometry to OBS", async (t) => {
  const { page, add, service, base, browser } = await setup(t);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jia0AAAAASUVORK5CYII=",
    "base64",
  );
  const upload = async (label) => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/stream-overlays/media") && r.request().method() === "POST",
    );
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles({ name: "tile.png", mimeType: "image/png", buffer: png });
    const result = await (await response).json();
    assert.equal(result.ok, true);
    await page.locator("#canvas img").filter({ visible: true }).first().waitFor();
    return result.url;
  };
  await add("Bingo board");
  await page.getByLabel("Board size").selectOption("2");
  const bingoName = page.getByLabel("Bingo text 1", { exact: true });
  await bingoName.fill("Opening square");
  await bingoName.press("Tab");
  await page.getByRole("button", { name: "Hide label for square 1" }).click();
  const blankBingo = page.getByLabel("Bingo text 2", { exact: true });
  await blankBingo.fill("Temporary name");
  await blankBingo.press("Tab");
  await blankBingo.clear();
  await blankBingo.press("Tab");
  await page.getByText("Board background image", { exact: true }).click();
  const image = await upload("Board image");
  await page.getByText("Square image", { exact: true }).click();
  const square = await upload("Square 1 image");
  await page.locator('[data-inspector="style"]').click();
  await page.getByLabel("Design preset").selectOption("Photo tiles");
  await page.getByLabel("Completed square").selectOption("both");
  await page.getByLabel("Completion symbol", { exact: true }).fill("★");
  await page.getByLabel("Completion symbol", { exact: true }).press("Tab");
  await page.getByLabel("Announcement text", { exact: true }).fill("Line complete");
  await page.getByLabel("Announcement text", { exact: true }).press("Tab");
  await page.getByLabel("Announcement placement").selectOption("overlay");
  await add("Challenge board");
  await page.locator('[data-inspector="content"]').click();
  await page.getByLabel("Tile layout").selectOption("freeform");
  await page.getByLabel("Tile label", { exact: true }).fill("First hero");
  await page.getByLabel("Tile label", { exact: true }).press("Tab");
  await page.getByLabel("Hide label on board", { exact: true }).check();
  assert.equal(await page.getByLabel("Tile label", { exact: true }).inputValue(), "First hero");
  assert.equal(
    await page
      .locator("#widgetFields > section > h3")
      .allTextContents()
      .then((text) => text.join(" / ")),
    "Board setup / Edit tiles",
  );
  await page.getByText("Tile placement", { exact: true }).click();
  for (const [label, value] of [
    ["Left (%)", "34"],
    ["Width (%)", "45"],
    ["Rotation (°)", "-22"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press("Tab");
  }
  const tileImage = await upload("Tile image");
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const [doc] = service.store.snapshot().documents;
  const [bingo, challenge] = doc.widgets;
  assert.deepEqual(bingo.boardHiddenLabels, { 0: true, 1: true });
  assert.equal(challenge.tiles[0].labelHidden, true);
  assert.equal(challenge.tiles[0].text, "First hero");
  assert.equal(
    service.bingoDeck({ documentId: doc.id, widgetId: challenge.id }).board.cells[0].text,
    "First hero",
  );
  for (const [widgetId, cell] of [
    [bingo.id, 1],
    [bingo.id, 2],
    [challenge.id, 1],
  ])
    service.gameControl({ documentId: doc.id, widgetId, operation: "mark", cell });
  const output = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  for (const view of [page, output]) {
    await view.locator(".bingoAnnouncement").getByText("Line complete").waitFor();
    assert.equal(await view.locator(".extra-bingo .bingoSymbol").first().textContent(), "★");
    assert.equal(await view.locator(".extra-bingo .bingoGrid > img").getAttribute("src"), image);
    assert.equal(await view.locator(".extra-bingo .bingoCell img").getAttribute("src"), square);
    assert.equal(
      await view
        .locator(".extra-bingo .bingoCell")
        .nth(0)
        .locator("span:not(.bingoSymbol)")
        .count(),
      0,
    );
    assert.equal(
      await view
        .locator(".extra-bingo .bingoCell")
        .nth(1)
        .locator("span:not(.bingoSymbol)")
        .count(),
      0,
    );
    const tile = view.locator(".extra-challenge-board .bingoCell.marked");
    assert.equal(await tile.locator("img").getAttribute("src"), tileImage);
    assert.equal(await tile.locator("span:not(.bingoSymbol)").count(), 0);
    assert.deepEqual(
      await tile.evaluate((node) => [node.style.left, node.style.width, node.style.transform]),
      ["34%", "45%", "rotate(-22deg)"],
    );
  }
  assert.equal((await output.locator("#output").boundingBox()).width, 960);
  await page.locator("#canvasOptions").click();
  await page.locator("#canvasWidth").fill("1200");
  await page.locator("#applySize").click();
  await page.keyboard.press("Escape");
  await page.locator("#openOutput").click();
  assert.match(
    await page.locator("#outputSize").textContent(),
    new RegExp("Width: " + doc.width + " px"),
  );
  assert.equal(await page.locator("#outputDraftNotice").isVisible(), true);
  await output.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  service.save({
    expectedRevision: service.store.revision(),
    document: { ...doc, width: 1234 },
  });
  await output.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await output.waitForFunction(() => document.querySelector("#output").style.width === "1234px");
});
test("board conditions, symbols, label positions, and hidden borders match OBS", async (t) => {
  const { page, add, service, browser, base } = await setup(t);
  await add("Challenge board");
  await page.getByLabel("Tile label", { exact: true }).fill("Photo task");
  await page.getByLabel("Tile label", { exact: true }).press("Tab");
  await page.getByLabel("Selected tile label position").selectOption("above");
  await page.getByLabel("Hide border on this tile").check();
  await page.getByText("Use an image URL", { exact: true }).first().click();
  await page
    .getByLabel("Tile image URL", { exact: true })
    .fill("https://example.invalid/photo.png");
  await page.getByLabel("Tile image URL", { exact: true }).press("Tab");
  await page.locator('[data-inspector="style"]').click();
  await page.getByText("Tile appearance", { exact: true }).click();
  await page.getByLabel("Tile label position", { exact: true }).selectOption("below");
  await page.getByLabel("Hide completed tiles", { exact: true }).check();
  await page.getByText("Failure mark", { exact: true }).click();
  const failureOpacity = page.getByLabel("Overlay opacity (%)", { exact: true });
  await failureOpacity.fill("40");
  await failureOpacity.press("Tab");
  await page.getByLabel("Condition symbol library").selectOption("⚠");
  await page.getByText("Custom tile conditions", { exact: true }).click();
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page.getByLabel("Condition name").fill("Needs another try");
  await page.getByLabel("Condition name").press("Tab");
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const [doc] = service.store.snapshot().documents;
  const [w] = doc.widgets;
  assert.equal(w.customConditions[0].name, "Needs another try");
  assert.equal(w.failureCondition.opacity, 40);
  assert.equal(w.failureCondition.symbol, "⚠");
  await page.locator('[data-inspector="content"]').click();
  await page.getByLabel("Mark as", { exact: true }).selectOption("failed");
  await page.getByRole("button", { name: "Set condition", exact: true }).click();
  await page.locator('#canvas [data-condition="failed"]').waitFor();
  for (const [cell, condition] of [
    [2, w.customConditions[0].id],
    [3, "completed"],
  ])
    service.gameControl({
      documentId: doc.id,
      widgetId: w.id,
      operation: "condition",
      cell,
      condition,
    });
  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  for (const view of [page, output]) {
    const tile = view.locator('.extra-challenge-board [data-condition="failed"]');
    await tile.waitFor();
    assert.equal(await tile.locator(".bingoSymbol").textContent(), "⚠");
    assert.equal(
      await tile.locator("img").getAttribute("src"),
      "https://example.invalid/photo.png",
    );
    assert.deepEqual(
      await tile.evaluate((el) => {
        const caption = el.querySelector(".bingoLabel").getBoundingClientRect();
        return [
          getComputedStyle(el, "::before").backgroundColor,
          getComputedStyle(el).borderTopColor,
          caption.bottom < el.getBoundingClientRect().top,
        ];
      }),
      ["rgba(185, 28, 28, 0.4)", "rgba(0, 0, 0, 0)", true],
    );
    const custom = view.locator(
      ".extra-challenge-board [data-condition=" + JSON.stringify(w.customConditions[0].id) + "]",
    );
    await custom.waitFor();
    assert.equal(await custom.getAttribute("data-label-position"), "below");
    const complete = view.locator('.extra-challenge-board [data-condition="completed"]');
    await complete.waitFor({ state: "attached" });
    assert.equal(await complete.isHidden(), true);
  }
});
test("Tile Match pairs can be edited and tried in the designer without changing the live overlay", async (t) => {
  const { page, add, service } = await setup(t);
  await add("Tile Match");
  await page.locator("#previewSource").selectOption("sample");
  await page.getByText("Moon", { exact: true }).click();
  await page.getByLabel("Pair 1 label", { exact: true }).fill("Night");
  await page.getByLabel("Pair 1 label", { exact: true }).press("Tab");
  await page.getByLabel("Hide label on board", { exact: true }).first().check();
  assert.equal(await page.locator("#canvas .bingoCell.covered").count(), 12);
  await page.getByRole("button", { name: "Flip tile 1", exact: true }).click();
  assert.equal(await page.locator("#canvas .bingoCell.covered").count(), 11);
  assert.equal(service.store.snapshot().documents.length, 0);
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const [doc] = service.store.snapshot().documents;
  assert.equal(doc.widgets[0].matchPairs[0].text, "Night");
  assert.equal(doc.widgets[0].matchPairs[0].labelHidden, true);
  assert.equal(
    service.bingoDeck({ documentId: doc.id }).board.cells.filter((cell) => cell.covered).length,
    12,
  );
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
  assert.equal(await page.getByLabel("Saved stat name (for example xp or wins)").count(), 0);
  await page.getByLabel("Watchtime display format").selectOption("years");
  await page.getByLabel("Leaderboard source").selectOption("points");
  assert.equal(await page.getByLabel("Watchtime display format").count(), 0);
  assert.equal(await page.getByLabel("Saved stat name (for example xp or wins)").count(), 0);
  await page.getByLabel("Leaderboard source").selectOption("stats");
  assert.equal(
    await page.getByLabel("Saved stat name (for example xp or wins)").isDisabled(),
    false,
  );
  await page.getByLabel("Saved stat name (for example xp or wins)").fill("wins");
  await page.getByLabel("Saved stat name (for example xp or wins)").press("Tab");
  await page.getByLabel("Leaderboard source").selectOption("watchtime");
  assert.equal(await page.getByLabel("Watchtime display format").inputValue(), "years");
  await page.getByLabel("Leaderboard source").selectOption("stats");
  assert.equal(
    await page.getByLabel("Saved stat name (for example xp or wins)").inputValue(),
    "wins",
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
  assert.equal(await page.locator("#widgetCatalog button").count(), 5);
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

test("credits actually scroll on both axes in designer and OBS with Windows reduced motion, and edits preserve the track", async (t) => {
  const { page, service, browser, base } = await setup(t);
  const saved = service.save({
    expectedRevision: 0,
    document: {
      widgets: [
        {
          id: "credits-motion",
          type: "credits",
          creditsSource: "manual",
          items: ["Alice", "Bob"],
          scrollDirection: "horizontal",
          scrollSeconds: 5,
          width: 600,
          height: 90,
        },
      ],
    },
  });
  const doc = saved.documents[0];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const output = await browser.newPage();
  await output.emulateMedia({ reducedMotion: "reduce" });
  output.setDefaultTimeout(8000);
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  const tracks = [page.locator("#canvas .creditsTrack"), output.locator("#output .creditsTrack")];
  for (const track of tracks) {
    await track.waitFor();
    const handle = await track.elementHandle();
    const before = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    await page.waitForTimeout(650);
    const after = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    assert.ok(
      Math.abs(after - before) > 2,
      "horizontal credits must visibly move across live feed ticks",
    );
    assert.equal(await handle.evaluate((el) => el.isConnected), true);
  }
  await page.locator(".layerRow").first().click();
  await page.getByLabel("Scroll direction", { exact: true }).selectOption("vertical");
  const track = tracks[0],
    handle = await track.elementHandle();
  await page.getByLabel("Seconds per full scroll", { exact: true }).fill("10");
  await page.getByLabel("Seconds per full scroll", { exact: true }).press("Tab");
  assert.equal(await track.evaluate((el) => getComputedStyle(el).animationDuration), "10s");
  assert.equal(await track.evaluate((el) => getComputedStyle(el).animationName), "creditsVertical");
  const before = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
  await page.waitForTimeout(650);
  const after = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
  assert.ok(
    Math.abs(after - before) > 1,
    "vertical credits must visibly move after changing direction",
  );
  assert.equal(await handle.evaluate((el) => el.isConnected), true);
  await page.locator("#canvasOptions").click();
  await page.getByLabel("Overlay animations", { exact: true }).selectOption("reduced");
  await page.locator('[data-close="canvasDialog"]').click();
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  assert.equal(service.store.snapshot().documents[0].motion, "reduced");
  for (const track of tracks) {
    await page.waitForTimeout(600);
    assert.equal(await track.evaluate((el) => getComputedStyle(el).animationName), "none");
  }
});

test("wheel visibly rotates through designer redraws and OBS polling, then lands on its shared selected entry", async (t) => {
  const { page, service, add, browser, base } = await setup(t);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await add("Wheel of names");
  await page.locator("#previewSource").selectOption("sample");
  await page.getByLabel("Spin duration (seconds)").fill("4");
  await page.getByLabel("Spin duration (seconds)").press("Tab");
  await page.getByRole("button", { name: "Spin wheel", exact: true }).click();
  const disc = page.locator("#canvas .wheelDisc");
  const handle = await disc.elementHandle();
  await page.waitForTimeout(100);
  const before = await disc.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(1200);
  assert.notEqual(await disc.evaluate((el) => getComputedStyle(el).transform), before);
  assert.equal(
    await handle.evaluate((el) => el.isConnected),
    true,
    "wheel SVG must survive redraws",
  );
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const doc = service.store.snapshot().documents[0],
    widget = doc.widgets[0];
  const output = await browser.newPage();
  await output.emulateMedia({ reducedMotion: "reduce" });
  output.setDefaultTimeout(8000);
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  await output.locator(".wheelDisc").waitFor();
  service.execute("overlay.game.spin", { widget: doc.id + "/" + widget.id });
  const live = output.locator(".wheelDisc");
  await output.getByText("Spinning...", { exact: true }).waitFor();
  const liveHandle = await live.elementHandle();
  const liveBefore = await live.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(1100);
  assert.notEqual(await live.evaluate((el) => getComputedStyle(el).transform), liveBefore);
  assert.equal(await liveHandle.evaluate((el) => el.isConnected), true);
  await output.getByText(/^Selected:/).waitFor();
  const state = (await service.data()).games[doc.id][widget.id];
  assert.equal(await output.locator(".overlayItem").textContent(), "Selected: " + state.winner);
  assert.equal(
    await liveHandle.evaluate((el) => el.isConnected),
    true,
    "revealing the result must retain the wheel",
  );
  const final = await live.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(300);
  assert.equal(await live.evaluate((el) => getComputedStyle(el).transform), final);
});

test("watchtime formatting and contextual controls match the saved OBS output without losing custom stat choices", async (t) => {
  const model = require("../public/core/overlay-model");
  const { page, add, service, browser, base } = await setup(t, (widgets) =>
    Object.fromEntries(
      widgets.map((w) => [
        model.recordKey(w),
        { entries: [{ player: "Viewer", value: 159515.6366 }] },
      ]),
    ),
  );
  await add("Leaderboard");
  const stat = page.getByLabel("Saved stat name (for example xp or wins)");
  await stat.fill("wins");
  await stat.press("Tab");
  await page.getByLabel("Leaderboard source").selectOption("watchtime");
  assert.equal(await stat.count(), 0);
  await page.getByLabel("Watchtime display format").selectOption("hours");
  await page.locator("#canvas").getByText("2,658.59 hours watched", { exact: true }).waitFor();
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const doc = service.store.snapshot().documents[0];
  assert.equal(doc.widgets[0].watchtimeFormat, "hours");
  assert.equal(doc.widgets[0].statField, "wins");
  const output = await browser.newPage();
  output.setDefaultTimeout(8000);
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  await output.getByText("2,658.59 hours watched", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".layerRow").first().click();
  assert.equal(await page.getByLabel("Watchtime display format").inputValue(), "hours");
  await page.getByLabel("Leaderboard source").selectOption("points");
  assert.equal(await page.getByLabel("Watchtime display format").count(), 0);
  assert.equal(await stat.count(), 0);
  await page.getByLabel("Leaderboard source").selectOption("stats");
  assert.equal(await stat.inputValue(), "wins");
  await add("Supporter credits");
  const names = page.locator('textarea[data-field="items"]');
  await page.getByLabel("Credit names").selectOption("manual");
  assert.equal(await names.isVisible(), true);
  assert.equal(await page.getByLabel("Period", { exact: true }).isVisible(), false);
  await page.getByLabel("Credit names").selectOption("followers");
  assert.equal(await names.isVisible(), false);
  assert.equal(await page.getByLabel("Period", { exact: true }).isVisible(), true);
  await add("Twitch chat");
  await page.getByLabel("Message removal").selectOption("scroll");
  assert.equal(await page.getByLabel("Message lifetime (seconds)").isVisible(), false);
  await page.getByLabel("Message removal").selectOption("expire");
  assert.equal(await page.getByLabel("Message lifetime (seconds)").isVisible(), true);
});

test("credit spacing, separators and text presets persist, and preview uses the full available viewport", async (t) => {
  const { page, add, service, browser, base } = await setup(t);
  await add("Supporter credits");
  await page.getByLabel("Credit names").selectOption("manual");
  const names = page.locator('textarea[data-field="items"]');
  await names.fill("Alice\nBob\nCarol");
  await names.press("Tab");
  await page.getByLabel("Scroll direction", { exact: true }).selectOption("horizontal");
  await page.getByLabel("Pause credit scroll").check();
  await page.getByLabel("Spacing between names (px)", { exact: true }).fill("48");
  await page.getByLabel("Spacing between names (px)", { exact: true }).press("Tab");
  await page.getByLabel("Separator between names (optional)").fill("�");
  await page.getByLabel("Separator between names (optional)").press("Tab");
  const spacing = await page
    .locator(".creditsGroup")
    .first()
    .evaluate((group) => {
      const names = group.querySelectorAll("div");
      return {
        gap: getComputedStyle(group).gap,
        spacing: names[1].offsetLeft - (names[0].offsetLeft + names[0].offsetWidth),
        separators: group.querySelectorAll(".creditSeparator").length,
      };
    });
  assert.equal(spacing.gap, "48px");
  assert.ok(spacing.spacing >= 96);
  assert.equal(spacing.separators, 3);
  await add("Text");
  await page.getByLabel("Text", { exact: true }).fill("COMMUNITY NIGHT");
  await page.getByLabel("Text", { exact: true }).press("Tab");
  await page.locator('[data-inspector="style"]').click();
  await page.getByLabel("Design preset", { exact: true }).selectOption("Lower third");
  const text = page.locator('#canvas .overlayLayer[data-widget-type="text"]');
  assert.equal(await text.evaluate((n) => getComputedStyle(n).borderLeftWidth), "5px");
  assert.equal(
    await text.locator(".widgetBody").evaluate((n) => getComputedStyle(n).paddingLeft),
    "22px",
  );
  await page.getByLabel("Text effect", { exact: true }).selectOption("outline");
  assert.equal(await page.getByLabel("Outline width (px)").isVisible(), true);
  assert.equal(await page.getByLabel("Shadow / glow blur (px)").count(), 0);
  await page.locator("#save").click();
  await page.locator("#saveState").getByText("Saved", { exact: true }).waitFor();
  const doc = service.store.snapshot().documents[0];
  assert.equal(doc.widgets[0].creditGap, 48);
  assert.equal(doc.widgets[1].paddingX, 22);
  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  await output.locator(".creditsGroup").first().waitFor();
  assert.equal(
    await output
      .locator(".creditsGroup")
      .first()
      .evaluate((n) => getComputedStyle(n).gap),
    "48px",
  );
  await page.locator("#zoom").selectOption("0.25");
  await page.locator("#preview").click();
  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector("#stageWrap").getBoundingClientRect(),
      canvas = document.querySelector("#stageFrame").getBoundingClientRect();
    return {
      wrap: { x: wrap.x, y: wrap.y, width: wrap.width, height: wrap.height },
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      rows: getComputedStyle(document.querySelector(".workspace")).gridTemplateRows,
    };
  });
  assert.ok(
    geometry.canvas.y < geometry.wrap.y + 80,
    "preview must not reserve an invisible sidebar row",
  );
  assert.ok(
    geometry.canvas.width > geometry.wrap.width * 0.8 ||
      geometry.canvas.height > geometry.wrap.height * 0.8,
    "preview must fit the full available viewport",
  );
  await page.locator("#endPreview").click();
  assert.equal(await page.locator("#zoom").inputValue(), "0.25");
});
