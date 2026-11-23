const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const createCoreServer = require("../src/app/core/create-core-server");
const model = require("../public/core/overlay-model");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
async function setup(t) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-overlay-rework-"));
  let service;
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: ["bits:read", "user:read:chat", "channel:read:charity"],
    }),
    refreshSubscriptions() {},
  };
  const core = createCoreServer({
    runtimeDir,
    dryRun: true,
    extend(context) {
      service = context.streamOverlays;
      return { twitchDashboard: () => provider };
    },
  });
  const server = await new Promise((resolve) => {
    const s = core.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  t.after(async () => {
    await browser.close();
    await core.services.lifecycle.stopAll();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  return { page, browser, base, service };
}
test("real Core policy allows chosen HTTPS alert media; amount variations queue and audio plays once per event", async (t) => {
  const { page, base, service } = await setup(t);
  const wav = Buffer.alloc(44 + 8000);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(8000, 40);
  wav.fill(128, 44);
  const upload = await fetch(base + "/api/stream-overlays/media", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  }).then((r) => r.json());
  assert.equal(upload.ok, true);
  const saved = service.save({
    expectedRevision: 0,
    document: model.document({
      widgets: [
        {
          id: "alert",
          type: "alerts",
          width: 640,
          height: 400,
          events: ["channel.cheer"],
          text: "Default ${name}",
          lifetime: 1,
          alertVariants: [
            {
              id: "large",
              event: "channel.cheer",
              minimum: 100,
              text: "${name}: ${amount} Bits",
              lifetime: 1,
              soundUrl: upload.url,
              volume: 25,
              mediaUrl: "https://media.example.test/celebrate.png",
            },
          ],
        },
      ],
    }),
  });
  await page.route("https://media.example.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.addInitScript(() => {
    const Native = window.Audio;
    window.alertAudio = [];
    window.Audio = function (url) {
      const audio = new Native(url);
      window.alertAudio.push(audio);
      return audio;
    };
  });
  await page.goto(base + "/stream-overlay.html?id=" + saved.selectedId);
  service.receive("channel.cheer", { user_name: "First", bits: 250 }, { message_id: "first" });
  service.receive("channel.cheer", { user_name: "Second", bits: 10 }, { message_id: "second" });
  await page.getByText("First: 250 Bits", { exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".alertMedia")?.naturalWidth > 0 &&
      window.alertAudio.length === 1 &&
      window.alertAudio[0].currentTime > 0,
  );
  assert.equal(await page.evaluate(() => window.alertAudio[0].volume), 0.25);
  await page.getByText("Default Second", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.alertAudio.length), 1);
});
test("designer saves and previews alert variations and named goals through the actual endpoints", async (t) => {
  const { page, base, service } = await setup(t);
  await page.goto(base + "/overlay-designer.html");
  const add = async (name) => {
    await page.locator("#add").click();
    await page.locator("#widgetCatalog").getByRole("button", { name, exact: true }).click();
  };
  await add("Twitch alerts");
  await page.getByRole("button", { name: "Add alert variation", exact: true }).click();
  await page.locator(".alertVariation summary").click();
  await page.getByLabel("Event type", { exact: true }).selectOption("channel.raid");
  await page.getByLabel("Minimum amount / viewers / months", { exact: true }).fill("50");
  await page.getByLabel("Minimum amount / viewers / months", { exact: true }).press("Tab");
  await page
    .getByLabel("Variation message (${name}, ${amount}, ${message}, ${tier}, ${currency})", {
      exact: true,
    })
    .fill("Welcome ${amount} raiders!");
  await page
    .getByLabel("Variation message (${name}, ${amount}, ${message}, ${tier}, ${currency})", {
      exact: true,
    })
    .press("Tab");
  await page.getByRole("button", { name: "Test variation", exact: true }).click();
  await page.locator("#emulate").click();
  await page.locator("#canvas").getByText("Welcome 50 raiders!", { exact: true }).waitFor();
  assert.deepEqual((await service.data()).events, [], "sample events never reach OBS or Twitch");
  await add("Goal");
  await page.getByLabel("Goal setup", { exact: true }).selectOption("bits");
  await page.locator("#save").click();
  await page.waitForFunction(async () =>
    Boolean((await fetch("/api/stream-overlays/goals").then((r) => r.json())).goals.bits),
  );
  service.receive("channel.cheer", { bits: 200 }, { message_id: "goal-event" });
  assert.equal(service.goals.snapshot("123").bits.current, 200);
  assert.equal(
    service.store.snapshot().documents[0].widgets.find((w) => w.type === "alerts").alertVariants[0]
      .minimum,
    50,
  );
  const reset = await fetch(base + "/api/stream-overlays/goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "reset", name: "bits" }),
  }).then((r) => r.json());
  assert.equal(reset.goals.bits.current, 0);
});
test("uploaded alert video decodes, survives live ticks and pauses when its layer is hidden", async (t) => {
  const { page, base, service } = await setup(t);
  await page.goto(base + "/overlay-designer.html");
  const upload = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = "#805ad5";
    context.fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(10),
      chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const ended = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 220));
    recorder.stop();
    await ended;
    stream.getTracks().forEach((track) => track.stop());
    return fetch("/api/stream-overlays/media", {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: new Blob(chunks, { type: "video/webm" }),
    }).then((r) => r.json());
  });
  assert.equal(upload.ok, true);
  const saved = service.save({
    expectedRevision: 0,
    document: model.document({
      widgets: [
        {
          id: "video-alert",
          type: "alerts",
          events: ["channel.cheer"],
          alert: { mediaUrl: upload.url },
          text: "${name}",
          lifetime: 10,
        },
      ],
    }),
  });
  await page.goto(base + "/stream-overlay.html?id=" + saved.selectedId);
  service.receive("channel.cheer", { user_name: "VideoViewer", bits: 1 }, { message_id: "video" });
  await page.waitForFunction(() => {
    const video = document.querySelector(".alertMedia");
    if (!video || video.readyState < 2 || !video.currentTime) return false;
    window.alertVideo = video;
    return true;
  });
  await page.waitForTimeout(600);
  assert.equal(
    await page.evaluate(
      () => window.alertVideo === document.querySelector(".alertMedia") && window.alertVideo.muted,
    ),
    true,
  );
  const doc = service.store.get(saved.selectedId);
  doc.widgets[0].visible = false;
  service.save({ expectedRevision: saved.revision, document: doc });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-widget-id="video-alert"]').style.display === "none" &&
      window.alertVideo.paused,
  );
});
test("entrance and ambient animations coexist, existing chat stays stable and all entrances support reduced motion", async (t) => {
  const { page, base } = await setup(t);
  await page.goto(base + "/overlay-designer.html");
  const results = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = OverlayModel.document({
      widgets: [
        {
          id: "text",
          type: "text",
          text: "Readable headline",
          entrance: "slide",
          ambient: "float",
        },
        { id: "chat", type: "chat", entrance: "slide-left", showTimestamps: true, itemPadding: 12 },
      ],
    });
    const data = {
      events: [
        {
          id: "one",
          type: "channel.chat.message",
          name: "Viewer",
          message: "A message",
          at: Date.now(),
        },
      ],
    };
    OverlayRenderer.render(host, doc, data);
    const text = host.querySelector('[data-widget-id="text"] .widgetBody');
    const chat = host.querySelector('[data-widget-id="chat"] .overlayItem');
    const animations = text.getAnimations().map((a) => a.animationName);
    OverlayRenderer.render(host, doc, data);
    const stable = chat === host.querySelector('[data-widget-id="chat"] .overlayItem');
    const names = [];
    for (const entrance of ["fade", "slide", "slide-left", "slide-right", "pop", "wipe", "blur"]) {
      doc.widgets[0].entrance = entrance;
      doc.widgets[0].ambient = "none";
      OverlayRenderer.render(host, doc, data);
      names.push(text.getAnimations().map((a) => a.animationName));
    }
    globalThis.motionExample = { host, doc, data };
    return { animations, stable, names, css: getComputedStyle(text).animationName };
  });
  assert.ok(results.animations.includes("overlaySlide"));
  assert.ok(results.animations.includes("overlayFloat"), JSON.stringify(results));
  assert.equal(results.stable, true);
  assert.ok(results.names.every((names) => names.length > 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const { host, doc, data } = globalThis.motionExample;
    doc.motion = "system";
    OverlayRenderer.render(host, doc, data);
  });
  assert.equal(
    await page.evaluate(
      () =>
        [...document.querySelectorAll(".overlayLayer")].flatMap((n) =>
          n.getAnimations({ subtree: true }),
        ).length,
    ),
    0,
  );
});
test("countdown pause survives Save and reload; now-playing progress keeps artwork and layout stable", async (t) => {
  const { page, base, service } = await setup(t);
  await page.goto(base + "/overlay-designer.html");
  await page.locator("#add").click();
  await page
    .locator("#widgetCatalog")
    .getByRole("button", { name: "Countdown", exact: true })
    .click();
  await page.getByRole("button", { name: "Start / restart countdown", exact: true }).click();
  await page.getByRole("button", { name: "Pause countdown", exact: true }).click();
  await page.locator("#save").click();
  await page.waitForFunction(
    async () =>
      (await fetch("/api/stream-overlays").then((r) => r.json())).documents[0]?.widgets[0]
        ?.countdownPaused === true,
  );
  await page.reload();
  await page.locator(".layerName").click();
  await page.getByRole("button", { name: "Resume countdown", exact: true }).waitFor();
  assert.equal(service.store.snapshot().documents[0].widgets[0].countdownPaused, true);
  const rendered = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = OverlayModel.document({
      widgets: [{ id: "music", type: "now-playing", entrance: "fade" }],
    });
    const data = OverlayRenderer.samples(),
      at = Date.now();
    OverlayRenderer.render(host, doc, data, { now: at });
    const artwork = host.querySelector(".musicArtwork"),
      progress = host.querySelector("progress"),
      body = host.querySelector(".widgetBody");
    OverlayRenderer.render(host, doc, data, { now: at + 2000 });
    return {
      sameArt: artwork === host.querySelector(".musicArtwork"),
      sameBody: body === host.querySelector(".widgetBody"),
      advanced: progress === host.querySelector("progress") && progress.value >= 67000,
      title: host.querySelector(".musicTitle").textContent,
    };
  });
  assert.deepEqual(rendered, {
    sameArt: true,
    sameBody: true,
    advanced: true,
    title: "Midnight City",
  });
});
