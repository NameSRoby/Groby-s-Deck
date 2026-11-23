const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  express = require("express");
const { chromium } = require("playwright");
async function setup(t, provider = null, fetchChatCatalog) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-overlay-ui-"));
  const app = express(),
    service = require("../src/domains/overlays/stream-overlays.service")({
      runtimeDir,
      getProvider: () => provider,
      ...(fetchChatCatalog ? { fetchChatCatalog } : {}),
    });
  app.use(express.json({ limit: "256kb" }));
  require("../src/app/core/register-stream-overlays.routes")(app, { service, runtimeDir, express });
  app.use(express.static(path.resolve(__dirname, "../public/core")));
  const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    }),
    browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1426, height: 1000 } });
  const page = await context.newPage(),
    base = "http://127.0.0.1:" + server.address().port,
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(7000);
  t.after(async () => {
    service.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await page.goto(base + "/overlay-designer.html");
  await page.waitForTimeout(100);
  const add = async (name) => {
    await page.locator("#add").click();
    await page.locator("#widgetCatalog").getByRole("button", { name, exact: true }).click();
  };
  return { page, base, service, browser, add };
}

test("editor and OBS mirror moderated chat and apply each cosmetic toggle independently", async (t) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  const channel = "123";
  const badge = "https://static-cdn.jtvnw.net/badges/v1/fixture-badge/2";
  const sevenTv = "01FCY771D800007PQ2DF3GDTN6";
  const bttv = "54fa8f1401e468494b85b537";
  const calls = [];
  const fetchCatalog = async (url, init) => {
    assert.equal(init.headers, undefined);
    calls.push(url);
    if (url.endsWith("/" + channel)) {
      if (url.includes("7tv.io")) {
        return Response.json({ emote_set: { emotes: [{ id: sevenTv, name: "Seven" }] } });
      }
      if (url.includes("betterttv.net")) {
        return Response.json({ sharedEmotes: [{ id: bttv, code: "Better" }] });
      }
      return Response.json({
        room: { set: 42 },
        sets: {
          42: { emoticons: [{ name: "Franker", urls: { 2: "//cdn.frankerfacez.com/emote/7/2" } }] },
        },
      });
    }
    if (url.includes("7tv.io")) return Response.json({ emotes: [] });
    if (url.includes("betterttv.net")) return Response.json([]);
    return Response.json({ default_sets: [] });
  };
  const provider = {
    status: () => ({ connected: true, userId: channel, scopes: ["user:read:chat"] }),
    refreshSubscriptions() {},
    overlayChatBadges: async () => ({
      ok: true,
      badges: [{ key: "moderator:1", title: "Moderator", url: badge }],
    }),
  };
  const { page, add, service, base } = await setup(t, provider, fetchCatalog);
  const editor = page.locator("#canvas");
  await page
    .context()
    .route(
      /^https:\/\/(?:static-cdn\.jtvnw\.net|cdn\.7tv\.app|cdn\.betterttv\.net|cdn\.frankerfacez\.com)\//,
      (route) => route.fulfill({ contentType: "image/png", body: png }),
    );
  await add("Twitch chat");
  const send = (id, userId, text, extra = {}) =>
    service.receive("channel.chat.message", {
      message_id: id,
      chatter_user_id: userId,
      chatter_user_name: "Chatter",
      message: { text },
      ...extra,
    });
  send("emotes", "viewer", "Kappa Seven Better Franker", {
    badges: [{ set_id: "moderator", id: "1" }],
    color: "#ff9900",
    message: {
      text: "Kappa Seven Better Franker",
      fragments: [
        { type: "emote", text: "Kappa", emote: { id: "25" } },
        { type: "text", text: " Seven Better Franker" },
      ],
    },
  });
  await editor.getByRole("img", { name: "Moderator" }).waitFor();
  await editor.getByRole("img", { name: "Kappa" }).waitFor();
  assert.equal(
    await editor.locator(".chatUsername").evaluate((el) => el.style.color),
    "rgb(255, 153, 0)",
  );
  assert.deepEqual(calls, []);
  for (const [label, image] of [
    ["7TV emotes", "Seven"],
    ["BetterTTV emotes", "Better"],
    ["FrankerFaceZ emotes", "Franker"],
  ]) {
    await page.getByLabel(label, { exact: true }).check();
    await editor.getByRole("img", { name: image }).waitFor();
  }
  await page.getByLabel("7TV emotes", { exact: true }).uncheck();
  await page.getByLabel("Twitch emotes", { exact: true }).uncheck();
  await page.getByLabel("Twitch chat badges", { exact: true }).uncheck();
  await page.getByLabel("Twitch username colors", { exact: true }).uncheck();
  assert.equal(await editor.getByRole("img").count(), 2);
  assert.equal(await editor.locator(".chatUsername").evaluate((el) => el.style.color), "");
  assert.match(await editor.textContent(), /Kappa Seven/);
  assert.equal(calls.length, 6);

  await page.getByText("Animation", { exact: true }).click();
  await page.getByLabel("Fade outgoing messages").check();
  await page.locator("#save").click();
  await page.locator("#notice").filter({ hasText: "Overlay saved" }).waitFor();
  const doc = service.store.snapshot().documents[0];
  const output = await page.context().newPage();
  let requested = false;
  await output.route("**/api/stream-overlays/data?fast=1", (route) => {
    if (requested) return route.abort();
    requested = true;
    return route.continue();
  });
  const feed = output.waitForRequest("**/api/stream-overlays/chat-feed");
  await output.goto(base + "/stream-overlay.html?id=" + doc.id);
  await feed;
  assert.equal(doc.widgets[0].exitAnimation, true);
  await page.route("**/api/stream-overlays/preview-data", (route) => route.abort());

  send("delete", "viewer", "Single message");
  send("ban1", "banned", "First banned message");
  send("ban2", "banned", "Second banned message");
  send("stay", "another", "Unrelated message");
  for (const view of [editor, output.locator("#output")]) {
    await view.getByText("Chatter: Single message", { exact: true }).waitFor();
    await view.getByText("Chatter: Second banned message", { exact: true }).waitFor();
  }
  service.receive("channel.chat.message_delete", { message_id: "delete" });
  service.receive("channel.chat.clear_user_messages", { target_user_id: "banned" });
  for (const view of [editor, output.locator("#output")]) {
    await view.getByText("Chatter: Single message", { exact: true }).waitFor({ state: "detached" });
    assert.doesNotMatch(await view.textContent(), /banned message/);
    assert.match(await view.textContent(), /Unrelated message/);
    assert.equal(await view.locator("[data-leaving]").count(), 0);
  }
  service.receive("channel.chat.clear");
  for (const view of [editor, output.locator("#output")]) {
    await view
      .getByText("Chatter: Unrelated message", { exact: true })
      .waitFor({ state: "detached" });
  }
});

test("live draft chat does not wait on subscriber data; credits roll on arrival and chat filters work", async (t) => {
  let finishSupporters;
  const supporterLookup = new Promise((resolve) => {
    finishSupporters = resolve;
  });
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: ["user:read:chat", "channel:read:subscriptions"],
    }),
    refreshSubscriptions() {},
    overlaySupporters: () => supporterLookup,
  };
  const { page, add, service, browser, base } = await setup(t, provider);
  await add("Supporter credits");
  assert.equal(await page.getByLabel("Credit names").inputValue(), "subscribers");
  await add("Twitch chat");
  assert.equal(await page.getByLabel("Message lifetime (seconds)").inputValue(), "10");
  const resizeHandle = await page
    .locator(".overlayLayer.selected > .resizeHandle")
    .first()
    .elementHandle();
  // The unsaved draft must request its actual events, not require saving an OBS document.
  for (let n = 0; n < 30 && !service.events().includes("channel.chat.message"); n++)
    await page.waitForTimeout(100);
  assert.ok(service.events().includes("channel.chat.message"));
  assert.equal(service.store.snapshot().documents.length, 0);
  const chat = (id, name, message, isAppMessage = false) =>
    service.receive(
      "channel.chat.message",
      {
        message_id: id,
        chatter_user_name: name,
        chatter_user_login: name.toLowerCase(),
        message: { text: message },
      },
      { isAppMessage },
    );
  chat("manual", "Broadcaster", "Typed by hand");
  chat("bot", "Broadcaster", "Automatic reply", true);
  chat("otherbot", "OtherBot", "External bot reply");
  await page.locator("#canvas").getByText("Broadcaster: Typed by hand", { exact: true }).waitFor();
  assert.equal(await resizeHandle.evaluate((node) => node.isConnected), true);
  finishSupporters({ ok: true, names: [{ name: "LiveSubscriber", at: null }] });
  await page
    .locator("#canvas .creditsTrack")
    .getByText("LiveSubscriber", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page
      .locator("#canvas .creditsTrack")
      .evaluate((el) => getComputedStyle(el).animationName),
    "creditsVertical",
  );
  assert.equal(
    await page.locator("#canvas [data-empty]").count(),
    0,
    "live content must replace its waiting placeholder",
  );
  await page
    .locator("#canvas")
    .getByText("Broadcaster: Automatic reply", { exact: true })
    .waitFor();
  await page.route("https://static-cdn.jtvnw.net/emoticons/v2/**", (route) =>
    route.fulfill({
      contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
    }),
  );
  service.receive("channel.chat.message", {
    message_id: "emote",
    chatter_user_name: "Viewer",
    message: {
      text: "Hello Kappa",
      fragments: [
        { type: "text", text: "Hello " },
        { type: "emote", text: "Kappa", emote: { id: "25" } },
      ],
    },
  });
  await page.locator("#canvas").getByRole("img", { name: "Kappa" }).waitFor();
  await page.getByLabel("Hide app-sent bot messages").check();
  assert.doesNotMatch(await page.locator("#canvas").textContent(), /Automatic reply/);
  assert.match(await page.locator("#canvas").textContent(), /Typed by hand/);
  await page.locator("#hiddenChatAccounts").fill("OtherBot");
  await page.locator("#hiddenChatAccounts").press("Enter");
  assert.doesNotMatch(await page.locator("#canvas").textContent(), /External bot reply/);
  await page.getByRole("button", { name: "Preview a chat message", exact: true }).click();
  await page.locator("#sampleMessage").fill("Local sample only");
  await page.locator("#emulate").click();
  await page
    .locator("#canvas")
    .getByText("DemoViewer: Local sample only", { exact: true })
    .waitFor();
  assert.ok(!(await service.data()).events.some((row) => row.message === "Local sample only"));
  await page.getByLabel("Message lifetime (seconds)").fill("2");
  await page.getByLabel("Message lifetime (seconds)").dispatchEvent("change");
  await page.locator("#save").click();
  await page.locator("#notice").filter({ hasText: "Overlay saved" }).waitFor();
  const saved = service.store.snapshot().documents[0];
  const savedChat = saved.widgets.find((widget) => widget.type === "chat");
  assert.equal(savedChat.lifetime, 2);
  assert.equal(savedChat.hideBotMessages, true);
  assert.deepEqual(savedChat.hiddenAccounts, ["otherbot"]);
  const output = await browser.newPage();
  await output.goto(base + "/stream-overlay.html?id=" + saved.id);
  chat("fresh", "Viewer", "Fresh live message");
  await output.getByText("Viewer: Fresh live message", { exact: true }).waitFor();
  assert.doesNotMatch(
    await output.locator("body").textContent(),
    /Local sample only|Automatic reply|External bot reply/,
  );
  await output
    .getByText("Viewer: Fresh live message", { exact: true })
    .waitFor({ state: "detached" });
  await page.getByLabel("Message removal", { exact: true }).selectOption("scroll");
  assert.equal(await page.getByLabel("Message lifetime (seconds)").isDisabled(), true);
  await page.locator('[data-inspector="animation"]').click();
  await page.getByRole("button", { name: "Message lifetime & filtering", exact: true }).click();
  assert.equal(await page.getByLabel("Message removal", { exact: true }).inputValue(), "scroll");
});

test("labels, polls and Hype Train read live draft feeds; sample mode remains explicitly local", async (t) => {
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: ["channel:read:polls", "channel:read:hype_train"],
    }),
    refreshSubscriptions() {},
    dashboardStream: async () => ({
      ok: true,
      live: true,
      title: "Live title",
      category: "Music",
      viewers: 42,
      startedAt: Date.now() - 60000,
    }),
  };
  const { page, add, service } = await setup(t, provider);
  await add("Stream title");
  await add("Twitch poll");
  await add("Hype Train");
  await page.locator("#canvas").getByText("Live title", { exact: true }).waitFor();
  service.receive("channel.poll.progress", {
    title: "Live poll",
    choices: [{ title: "Adventure", votes: 7 }],
  });
  service.receive("channel.hype_train.progress", { level: 3, total: 75, goal: 100 });
  await page.locator("#canvas").getByText("Live poll", { exact: true }).waitFor();
  await page.locator("#canvas").getByText("Hype Train - Level 3", { exact: true }).waitFor();
  await page.locator("#previewSource").selectOption("sample");
  await page.locator("#canvas").getByText("A cosy evening stream", { exact: true }).waitFor();
  assert.equal(service.store.snapshot().documents.length, 0);
  await page.locator("#previewSource").selectOption("live");
  await page.locator("#canvas").getByText("Live title", { exact: true }).waitFor();
});

test("overlay draft releases live interests while hidden and keeps sample clocks current", async (t) => {
  const { page, add, service } = await setup(t, {
    status: () => ({ connected: true, userId: "123", scopes: ["user:read:chat"] }),
    refreshSubscriptions() {},
  });
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
  await page.reload();
  await add("Twitch chat");
  await add("Clock");
  const waitForChatInterest = async (expected) => {
    for (let n = 0; n < 40; n++) {
      if (service.events().includes("channel.chat.message") === expected) return;
      await page.waitForTimeout(50);
    }
    assert.equal(service.events().includes("channel.chat.message"), expected);
  };
  await waitForChatInterest(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await waitForChatInterest(false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await waitForChatInterest(true);

  await page.locator("#previewSource").selectOption("sample");
  await waitForChatInterest(false);
  const clock = page.locator("#canvas > .overlayLayer:last-child > .widgetBody");
  const time = await clock.textContent();
  await page.waitForFunction(
    (previous) =>
      document.querySelector("#canvas > .overlayLayer:last-child > .widgetBody").textContent !==
      previous,
    time,
  );
  assert.equal(service.events().includes("channel.chat.message"), false);
});

test("every implemented data widget has a renderable sample using the same renderer as OBS", async (t) => {
  const { page } = await setup(t);
  const missing = await page.evaluate(() => {
    const types = [
      "chat",
      "activity",
      "alerts",
      "queue",
      "title",
      "category",
      "viewers",
      "uptime",
      "followers",
      "latest-follower",
      "subscribers",
      "sub-points",
      "poll",
      "hype-train",
      "credits",
      "now-playing",
      "rotating-text",
    ];
    return types.filter((type) => {
      const host = document.createElement("div");
      const draft = OverlayModel.document({
        widgets: [{ id: type, type, items: ["Sample entry"], lifetime: 10 }],
      });
      OverlayRenderer.render(host, draft, OverlayRenderer.samples());
      return !host.textContent.trim();
    });
  });
  assert.deepEqual(missing, []);
});

test("live renders keep static media and replace it when the configured source changes", async (t) => {
  const { page } = await setup(t);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    const draft = OverlayModel.document({
      widgets: [{ id: "media", type: "video", url: "https://example.invalid/first.mp4" }],
    });
    const createElement = document.createElement;
    let mediaCreated = 0;
    document.createElement = function (tag, ...args) {
      if (tag === "video") mediaCreated++;
      return createElement.call(this, tag, ...args);
    };
    try {
      OverlayRenderer.render(host, draft, {});
      const first = host.querySelector("video");
      draft.widgets[0].name = "Renamed video";
      OverlayRenderer.render(host, draft, { connected: true });
      const reused = first === host.querySelector("video");
      draft.widgets[0].url = "https://example.invalid/second.mp4";
      OverlayRenderer.render(host, draft, {});
      return { reused, mediaCreated, source: host.querySelector("video").src };
    } finally {
      document.createElement = createElement;
    }
  });
  assert.deepEqual(result, {
    reused: true,
    mediaCreated: 2,
    source: "https://example.invalid/second.mp4",
  });
});

test("an older running backend cannot silently discard the new chat filters", async (t) => {
  const provider = {
    status: () => ({ connected: true, userId: "123", scopes: ["user:read:chat"] }),
    refreshSubscriptions() {},
  };
  const { page, add, service } = await setup(t, provider);
  await page.route(/\/api\/stream-overlays$/, async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    delete body.livePreview;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await add("Twitch chat");
  await page.getByLabel("Hide app-sent bot messages").check();
  await page.locator("#save").click();
  await page
    .locator("#notice")
    .filter({ hasText: "Restart Groby's Deck to save chat filters" })
    .waitFor();
  assert.equal(service.store.snapshot().documents.length, 0);
  assert.equal(await page.getByLabel("Hide app-sent bot messages").isChecked(), true);
});

test("widgets delete from the layer row or inspector, undo restores selection, and locks explain deletion", async (t) => {
  const { page, add, service } = await setup(t);
  await add("Text");
  await add("Text");
  const layers = page.locator("#canvas .overlayLayer");
  assert.equal(await layers.count(), 2);
  await page.locator('.layerRow.selected button[aria-label^="Delete widget "]').click();
  assert.equal(await layers.count(), 1);
  await page.locator("#undo").click();
  assert.equal(await layers.count(), 2);
  assert.equal(await page.locator("#canvas .selected").count(), 1);
  await page.locator(".editTools summary").click();
  await page.locator("#lockSelection").click();
  assert.equal(await page.locator("#deleteSelection").isDisabled(), true);
  assert.match(await page.locator("#deleteSelection").getAttribute("title"), /Unlock/);
  await page.locator("#lockSelection").click();
  await page.locator("#deleteSelection").click();
  assert.equal(await layers.count(), 1);
  await page.locator("#undo").click();
  await page.locator("#canvas").press("Control+a");
  assert.equal(await page.locator("#canvas .selected").count(), 2);
  await page.locator("#canvas").press("Control+c");
  await page.locator("#canvas").press("Control+v");
  assert.equal(await layers.count(), 4);
  await page.locator("#undo").click();
  assert.equal(await layers.count(), 2);
  await page.locator("#canvas").press("Delete");
  assert.equal(await layers.count(), 0);
  await page.locator("#undo").click();
  assert.equal(await layers.count(), 2);
  await page.locator("#layerSearch").fill("absent");
  assert.equal(await page.locator(".layerRow:visible").count(), 0);
  await page.locator("#layerSearch").fill("text");
  assert.equal(await page.locator(".layerRow:visible").count(), 2);
  assert.equal(
    service.store.snapshot().documents.length,
    0,
    "draft edits do not affect saved OBS output",
  );
});

test("committing an inspector field preserves the next click and edits the original layer", async (t) => {
  const { page, add } = await setup(t);
  await add("Text");
  await add("Text");
  await page.locator('[data-inspector="position"]').click();
  await page.locator('[data-field="name"]').fill("Front title");
  await page.locator('[data-field="x"]').click();
  assert.equal(
    await page.locator('[data-field="x"]').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator('[data-field="x"]').fill("240");
  await page.locator(".layerName").last().click();
  assert.equal(await page.locator(".layerRow.selected .layerName").textContent(), "Text");
  await page.locator(".layerName").filter({ hasText: "Front title" }).click();
  assert.equal(await page.locator('[data-field="x"]').inputValue(), "240");
});

test("Escape cancels canvas gestures; layout export/import stays editable without replacing saved documents", async (t) => {
  const { page, add } = await setup(t);
  await add("Text");
  const layer = page.locator("#canvas .overlayLayer"),
    before = await layer.getAttribute("style"),
    box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await layer.getAttribute("style"), before);
  await page.locator(".editTools summary").click();
  const download = page.waitForEvent("download");
  await page.locator("#exportLayout").click();
  const file = await (await download).path();
  const content = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(content.widgets.length, 1);
  await page.locator("#importLayout").setInputFiles({
    name: "layout.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...content, name: "Imported layout" })),
  });
  await page.locator("#confirmYes").click();
  await page.locator("#notice").filter({ hasText: "Layout imported" }).waitFor();
  assert.equal(await page.locator("#documentName").inputValue(), "Imported layout");
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 1);
  assert.equal(
    await page.locator("#saveState").textContent(),
    "New overlay - save to create its OBS link",
  );
});

test("renaming, distributing and reordering layers remain reversible in the fitted workspace", async (t) => {
  const { page, add } = await setup(t);
  for (let i = 0; i < 3; i++) {
    await add("Text");
    await page.locator("#canvas").press("F2");
    await page.locator('[data-field="name"]').fill("Panel " + i);
    await page.locator('[data-field="name"]').dispatchEvent("change");
    await page.locator('[data-field="x"]').fill(String([0, 600, 1300][i]));
    await page.locator('[data-field="x"]').dispatchEvent("change");
  }
  await page.locator(".editTools summary").click();
  await page.locator("#selectAll").click();
  await page.locator('[data-align-selection="horizontal"]').click();
  assert.deepEqual(
    await page
      .locator("#canvas .overlayLayer")
      .evaluateAll((rows) => rows.map((row) => parseFloat(row.style.left))),
    [0, 650, 1300],
  );
  await page.locator(".layerName").filter({ hasText: "Panel 2" }).click();
  await page.locator(".editTools summary").click();
  await page.locator("#sendToBack").click();
  assert.deepEqual(await page.locator(".layerName").allTextContents(), [
    "Panel 1",
    "Panel 0",
    "Panel 2",
  ]);
  await page.locator("#undo").click();
  assert.deepEqual(await page.locator(".layerName").allTextContents(), [
    "Panel 2",
    "Panel 1",
    "Panel 0",
  ]);
  const before = await page.locator(".layerName").allTextContents();
  await page
    .locator(".layerName")
    .filter({ hasText: "Panel 0" })
    .dragTo(page.locator(".layerName").filter({ hasText: "Panel 2" }));
  assert.notDeepEqual(await page.locator(".layerName").allTextContents(), before);
  await page.locator("#undo").click();
  assert.deepEqual(await page.locator(".layerName").allTextContents(), before);
  assert.ok(
    await page.evaluate(() => document.body.scrollHeight <= innerHeight),
    "desktop workspace fits its viewport",
  );
});
test("designer separates canvas and widget controls, resizes, persists, undoes and renders the same transparent output", async (t) => {
  const { page, service, base, browser, add } = await setup(t);
  assert.equal(await page.locator("#canvasWidth").inputValue(), "1920");
  assert.equal(await page.locator("#canvasHeight").inputValue(), "1080");
  await add("Text");
  await page.locator('[data-field="text"]').fill("My overlay");
  await page.locator('[data-field="text"]').press("Tab");
  assert.match(await page.locator("#canvas").textContent(), /My overlay/);
  await page.locator("#canvasOptions").click();
  await page.locator("#sizePreset").selectOption("720p");
  await page.locator("#applySize").click();
  await page.locator('[data-close="canvasDialog"]').click();
  assert.equal(await page.locator("#canvas").evaluate((el) => el.style.width), "1280px");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#canvas").evaluate((el) => el.style.width), "1920px");
  await page.locator("#redo").click();
  await page.locator("#canvas .overlayLayer").click();
  await page.locator("#canvas").press("ArrowRight");
  await page.locator('#widgetSettings [data-inspector="position"]').click();
  assert.equal(await page.locator('[data-field="x"]').inputValue(), "81");
  const handle = page.locator('[data-corner="se"]'),
    box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
  await page.mouse.up();
  assert.ok(Number(await page.locator('[data-field="width"]').inputValue()) > 480);
  await page.locator("#save").click();
  await page.locator("#notice").filter({ hasText: "Overlay saved" }).waitFor();
  assert.equal(await page.locator("#savedOverlays button").count(), 1);
  const saved = service.store.snapshot().documents[0];
  assert.match(await page.locator("#savedOverlays").textContent(), new RegExp(saved.name));
  await page.locator('#widgetSettings [data-inspector="style"]').click();
  await page.getByLabel("Design preset", { exact: true }).selectOption("Paper");
  assert.equal(await page.locator('[data-field="background"]').inputValue(), "#f4efe5");
  await page.locator("#undo").click();
  assert.equal(saved.widgets[0].text, "My overlay");
  await page.locator("#canvas .overlayLayer").click();
  const output = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await output.goto(base + "/stream-overlay.html?id=" + saved.id);
  await output.getByText("My overlay", { exact: true }).waitFor();
  assert.equal(
    await output.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(await output.locator(".resizeHandle").count(), 0);
  await page.locator('#widgetSettings [data-inspector="content"]').click();
  await page.locator('[data-field="text"]').fill("Unsaved draft");
  await page.locator('[data-field="text"]').press("Tab");
  await output.waitForTimeout(2200);
  assert.equal((await output.locator("body").textContent()).trim(), "My overlay");
  await page.locator("#preview").click();
  assert.equal(await page.locator("#previewBanner").isVisible(), true);
  await page.locator("#endPreview").click();
  assert.match(await page.locator("#canvas").textContent(), /Unsaved draft/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
test("custom code runs in an opaque frame with data fields, and the picker explains unavailable providers", async (t) => {
  const { page, add } = await setup(t);
  await page.locator("#add").click();
  assert.doesNotMatch(await page.locator("#widgetCatalog").textContent(), /Merchandise|Tips/);
  assert.match(await page.locator("#widgetCatalog").textContent(), /Enable Twitch Integration/);
  await page.locator('[data-close="catalogDialog"]').click();
  await add("Custom HTML / CSS / JS");
  await page.locator('[data-field="html"]').fill('<div id="value">Before</div>');
  await page.locator('[data-field="html"]').press("Tab");
  await page.getByRole("button", { name: "JS", exact: true }).click();
  await page
    .locator('[data-field="js"]')
    .fill('document.getElementById("value").textContent="Custom code works";');
  await page.locator('[data-field="js"]').press("Tab");
  const frame = page.frameLocator("#canvas iframe");
  await frame.getByText("Custom code works", { exact: true }).waitFor();
  assert.equal(await page.locator("#canvas iframe").getAttribute("sandbox"), "allow-scripts");
  const blocked = await frame.locator("body").evaluate(() => {
    try {
      return parent.document.body.innerHTML;
    } catch {
      return "blocked";
    }
  });
  assert.equal(blocked, "blocked");
  const queued = await page.evaluate(() => {
    const host = document.createElement("div"),
      w = OverlayModel.widget({ id: "test-alert", type: "alerts", lifetime: 1 });
    const doc = OverlayModel.document({ widgets: [w] }),
      data = {
        events: [
          { id: "a", name: "First", type: "channel.follow", message: "followed", at: 10000 },
          { id: "b", name: "Second", type: "channel.follow", message: "followed", at: 10000 },
        ],
      };
    return [10000, 11001, 12002, 13003].map((now) => {
      OverlayRenderer.render(host, doc, data, { now });
      return host.textContent;
    });
  });
  assert.deepEqual(queued, ["First followed", "Second followed", "", ""]);
});

test("animated cards preserve old messages, expire safely and honor reduced motion; rotations and credits use editable data", async (t) => {
  const { page, add, service } = await setup(t);
  await add("Text");
  await page.locator('[data-inspector="animation"]').click();
  await page.getByLabel("Animated preset", { exact: true }).selectOption("Soft reveal");
  await page.locator("#save").click();
  await page.locator("#notice").filter({ hasText: "Overlay saved" }).waitFor();
  assert.equal(service.store.snapshot().documents[0].widgets[0].entrance, "fade");
  const result = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const w = OverlayModel.widget({
      id: "chat-test",
      type: "chat",
      entrance: "slide",
      exitAnimation: true,
      animationMs: 100,
      lifetime: 2,
      itemOpacity: 90,
    });
    const doc = OverlayModel.document({ widgets: [w] });
    const event = (id, at) => ({
      id,
      name: "Viewer",
      message: id,
      type: "channel.chat.message",
      at,
    });
    OverlayRenderer.render(host, doc, { events: [event("one", 1000)] }, { now: 1000 });
    const first = host.querySelector('[data-item-key="one"]');
    OverlayRenderer.render(
      host,
      doc,
      { events: [event("one", 1000), event("two", 2000)] },
      { now: 2000 },
    );
    const stable = first === host.querySelector('[data-item-key="one"]');
    OverlayRenderer.render(
      host,
      doc,
      { events: [event("one", 1000), event("two", 2000)] },
      { now: 3100 },
    );
    const leaving = first.dataset.leaving === "true";
    await new Promise((r) => setTimeout(r, 130));
    const removed = !host.contains(first);
    doc.widgets[0].chatMode = "scroll";
    OverlayRenderer.render(host, doc, { events: [event("three", 1000)] }, { now: 100000 });
    const persistent = host.textContent.includes("three");
    const rotate = OverlayModel.document({
      widgets: [{ id: "rotate", type: "rotating-text", items: ["Alpha", "Beta"], rotateEvery: 2 }],
    });
    OverlayRenderer.render(host, rotate, {}, { now: 0 });
    const alpha = host.textContent;
    OverlayRenderer.render(host, rotate, {}, { now: 2000 });
    const beta = host.textContent;
    const credits = OverlayModel.document({
      widgets: [
        { id: "credits", type: "credits", items: ["Alice", "Bob"], scrollDirection: "horizontal" },
      ],
    });
    OverlayRenderer.render(host, credits, {}, { now: 0 });
    const track = host.querySelector(".creditsTrack"),
      repeated = track.children.length === 2;
    const animation = getComputedStyle(track).animationName;
    const clipped = getComputedStyle(host.querySelector(".creditsViewport")).overflow;
    host.remove();
    return { stable, leaving, removed, persistent, alpha, beta, repeated, animation, clipped };
  });
  assert.deepEqual(result, {
    stable: true,
    leaving: true,
    removed: true,
    persistent: true,
    alpha: "Alpha",
    beta: "Beta",
    repeated: true,
    animation: "creditsHorizontal",
    clipped: "hidden",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#canvasOptions").click();
  await page.getByLabel("Overlay animations", { exact: true }).selectOption("system");
  await page.locator('[data-close="canvasDialog"]').click();
  assert.equal(
    await page
      .locator(".widgetBody")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
});

test("studio maximizes the canvas and restores side panels without losing widgets", async (t) => {
  const { page, add } = await setup(t);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await add("Text");
  const initial = await page.locator("#stageWrap").boundingBox();
  assert.ok(initial.height > 800);
  await page.locator("#overlayLibrary > summary").click();
  assert.equal(await page.locator("#new").isVisible(), true);
  assert.equal((await page.locator("#stageWrap").boundingBox()).height, initial.height);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#new").isVisible(), false);
  await page.locator("#toggleLayers").click();
  await page.locator("#toggleInspector").click();
  const expanded = await page.locator("#stageWrap").boundingBox();
  assert.ok(expanded.width > 1800);
  assert.ok(expanded.width > initial.width + 240);
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 1);
  await page.locator("#toggleInspector").click();
  assert.equal(await page.locator(".inspectorPanel").isVisible(), true);
});

test("canvas options stay in the top toolbar and widget sections stay on the left; familiar shortcuts and context menu edit the draft", async (t) => {
  const { page, add } = await setup(t);
  assert.equal(await page.locator("#canvasSettings").isVisible(), false);
  const top = await page.locator("#canvasOptions").boundingBox();
  assert.ok(top.y < 80);
  await page.locator("#canvasOptions").click();
  await page.locator("#documentName").fill("Community night");
  await page.locator("#documentName").press("Tab");
  await page.locator('[data-close="canvasDialog"]').click();
  await add("Text");
  await page.locator('[data-inspector="style"]').click();
  await page.getByLabel("Font", { exact: true }).selectOption("installed");
  await page.getByLabel("Font family name").fill("Verdana");
  await page.getByLabel("Font family name").press("Tab");
  assert.match(
    await page.locator("#canvas .overlayLayer").evaluate((layer) => layer.style.fontFamily),
    /Verdana/,
  );
  const fields = await page.locator("#widgetSettings").boundingBox(),
    canvas = await page.locator("#stageWrap").boundingBox();
  assert.ok(fields.x + fields.width <= canvas.x + 1);
  await page.locator('[data-inspector="position"]').click();
  await page.locator('[data-field="x"]').fill("600");
  await page.locator('[data-field="x"]').press("Tab");
  await page.locator("#canvas").press("Shift+D");
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 2);
  await page.locator("#canvas").press("Alt+x");
  assert.equal(await page.locator("#zoom").inputValue(), "1");
  await page.locator("#canvas").press("Alt+f");
  assert.equal(await page.locator("#zoom").inputValue(), "fit");
  await page.locator("#canvas .overlayLayer").last().click({ button: "right" });
  assert.equal(
    await page
      .locator("#canvasMenu")
      .getByRole("menuitem", { name: "Group selection" })
      .isDisabled(),
    true,
  );
  await page.locator("#canvasMenu").getByRole("menuitem", { name: "Delete", exact: true }).click();
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 1);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#canvas .overlayLayer").count(), 2);
  await page.setViewportSize({ width: 740, height: 920 });
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
