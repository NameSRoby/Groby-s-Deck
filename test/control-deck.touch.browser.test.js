const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const express = require("express"),
  { chromium } = require("playwright");

async function fixture(t, { supported = true, width = 430, height = 1000 } = {}) {
  const app = express();
  app.use(express.static(path.resolve(__dirname, "../public/core")));
  app.get("/fixture", (_req, res) =>
    res.type("html").send(`<!doctype html>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/control-deck.css">
  <main id="host" class="controlDeck" data-editing="false" data-focus="false" data-slider-orientation="vertical" data-slider-fill="false">
  <div class="deckToolbar"></div>
  <section class="deckInlineMixer deckWindowsPanel" data-orientation="vertical"><div class="deckMixerChannels">
  <div class="deckButton" data-slider-style="mixer" data-slider-orientation="vertical" data-deck-button="volume">
  <span class="deckButtonTitle">Demo volume</span><div class="deckFaderTrack"><input class="deckVolumeSlider" type="range" min="0" max="100" value="50" aria-label="Demo volume"></div><output class="deckSliderValue"></output></div>
  </div></section><div class="deckGrid"><button id="action" class="deckButton" data-deck-button="action">Demo action</button></div></main>
  <script type="module">
  import {bindDeckSlider} from '/control-deck-slider.js';
  import {createDeckDisplay} from '/control-deck-display.js';
  import {createDeckHaptics} from '/control-deck-haptics.js';
  window.config={layout:{hapticsEnabled:false,hapticsSensitivity:50}};
  window.writes=[];window.saved=[];window.active=0;window.maxActive=0;window.actions=0;
  window.host=document.getElementById('host');window.input=document.querySelector('.deckVolumeSlider');
  window.control=bindDeckSlider({input,output:document.querySelector('.deckSliderValue'),send:async value=>{
  active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,80));writes.push(value);active--;}});
  createDeckHaptics({host,getConfig:()=>config,save:async value=>{config=structuredClone(value);saved.push(value);},explain:e=>e.message});
  window.display=createDeckDisplay(host);display.schedule();document.getElementById('action').onclick=()=>actions++;
  window.ready=true;</script>`),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
  });
  await page.addInitScript((supported) => {
    window.vibrations = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: supported
        ? (duration) => {
            window.vibrations.push(duration);
            return true;
          }
        : undefined,
    });
  }, supported);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.waitForFunction(() => window.ready);
  page.setDefaultTimeout(5000);
  return page;
}

test("touch faders offer large tap/hold steps, exact entry, serialized writes and cancellation", async (t) => {
  const page = await fixture(t),
    up = page.getByRole("button", { name: "Increase Demo volume" });
  const bounds = await up.boundingBox();
  assert(bounds.width >= 44 && bounds.height >= 44);
  const range = page.locator(".deckVolumeSlider"),
    card = page.locator('[data-deck-button="volume"]'),
    surface = await range.boundingBox(),
    cardBounds = await card.boundingBox();
  assert(surface.width / cardBounds.width >= 0.8, "most of the fader face is an actual input");
  assert(
    bounds.y >= surface.y + surface.height,
    "precision buttons sit together below the adjustment surface",
  );
  await up.tap();
  await page.waitForFunction(() => writes.at(-1) === 51);
  assert.equal(
    await page.locator(".deckVolumeSlider").inputValue(),
    "51",
    "one tap is exactly one increment",
  );
  await range.tap({ position: { x: 2, y: 10 } });
  assert(Number(await range.inputValue()) >= 95, "even the edge of the wide face adjusts volume");
  await range.tap({ position: { x: surface.width - 2, y: surface.height - 10 } });
  assert(Number(await range.inputValue()) <= 5);
  await page.evaluate(() => control.sync(51));
  // Return to the last committed value through the exact entry path.
  await page.locator(".deckSliderValue").tap();
  await page.getByRole("spinbutton", { name: "Demo volume exact percent" }).fill("51");
  await page.getByRole("spinbutton", { name: "Demo volume exact percent" }).press("Enter");
  const cdp = await page.context().newCDPSession(page);
  const touch = (type) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchStart"
          ? [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
          : [],
    });
  await touch("touchStart");
  await page.waitForTimeout(800);
  await touch("touchEnd");
  const heldValue = Number(await page.locator(".deckVolumeSlider").inputValue());
  assert(heldValue >= 54 && heldValue <= 58, "hold adjusts slowly rather than jumping to maximum");
  await page.waitForTimeout(400);
  assert.equal(
    Number(await page.locator(".deckVolumeSlider").inputValue()),
    heldValue,
    "release stops repetition",
  );
  await touch("touchStart");
  await touch("touchCancel");
  const cancelled = await page.locator(".deckVolumeSlider").inputValue();
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".deckVolumeSlider").inputValue(), cancelled);
  await page.locator(".deckSliderValue").tap();
  const exact = page.getByRole("spinbutton", { name: "Demo volume exact percent" });
  await exact.fill("37");
  await exact.press("Enter");
  await page.waitForFunction(() => writes.at(-1) === 37);
  assert.equal(await page.evaluate(() => maxActive), 1);
  await page.evaluate(() => control.close());
  assert.equal(await page.locator(".deckSliderStep").count(), 0);
});

test("fill-space faders adapt to portrait height and release space when disabled", async (t) => {
  const page = await fixture(t, { height: 1200 });
  const slider = page.locator(".deckVolumeSlider");
  const compact = (await slider.boundingBox()).height;
  await page.evaluate(() => {
    host.dataset.sliderFill = "true";
    display.schedule();
  });
  await page.waitForFunction(
    () => document.querySelector(".deckVolumeSlider").getBoundingClientRect().height > 400,
  );
  const tall = (await slider.boundingBox()).height;
  await page.setViewportSize({ width: 430, height: 850 });
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".deckVolumeSlider").getBoundingClientRect().height < previous,
    tall,
  );
  await page.evaluate(() => {
    host.dataset.sliderFill = "false";
    display.schedule();
  });
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".deckVolumeSlider").getBoundingClientRect().height === previous,
    compact,
  );
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.evaluate(() => {
    host.dataset.sliderOrientation = "horizontal";
    document.querySelector(".deckWindowsPanel").dataset.orientation = "horizontal";
    document.querySelector("[data-deck-button]").dataset.sliderOrientation = "horizontal";
  });
  const narrow = (await slider.boundingBox()).width;
  await page.evaluate(() => {
    host.dataset.sliderFill = "true";
    display.schedule();
  });
  await page.waitForFunction(
    (before) =>
      document.querySelector(".deckVolumeSlider").getBoundingClientRect().width > before + 100,
    narrow,
  );
  await page.evaluate(() => (host.dataset.paged = "true"));
  assert.equal(
    (await slider.boundingBox()).height,
    44,
    "fullscreen paging keeps horizontal faders compact",
  );
});

test("filled native channels fit after async discovery and stay stable in a stretched mixer row", async (t) => {
  const page = await fixture(t, { height: 1200, width: 900 });
  await page.evaluate(() => {
    host.dataset.sliderFill = "true";
    const card = document.createElement("section");
    card.className = "deckWindowsAudioCard";
    card.innerHTML =
      '<div class="deckWindowsAudioHeading"><strong>Demo native audio</strong><small>Demo output</small></div><div class="deckWindowsAudioValues"><div class="deckFaderTrack"><input type="range" min="0" max="100" value="50"></div><output>50%</output><button>Mute</button></div>';
    document.querySelector(".deckMixerChannels").append(card);
    host.dispatchEvent(new Event("ravelink-deck-mixer-layout"));
  });
  const native = page.locator(".deckWindowsAudioCard input");
  await page.waitForFunction(
    () =>
      document.querySelector(".deckWindowsAudioCard input").getBoundingClientRect().height > 400,
  );
  const length = (await native.boundingBox()).height;
  for (let at = 0; at < 4; at++) {
    await page.evaluate(() => display.schedule());
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal((await native.boundingBox()).height, length);
  }
  await page.evaluate(() => {
    document.querySelector(".deckWindowsAudioCard").hidden = true;
    host.dispatchEvent(new Event("ravelink-deck-screen-change"));
  });
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".deckWindowsAudioCard .deckFaderTrack")
        .style.getPropertyValue("--deck-fader-length"),
  );
  await page.evaluate(() => {
    document.querySelector(".deckWindowsAudioCard").hidden = false;
    host.dispatchEvent(new Event("ravelink-deck-screen-change"));
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".deckWindowsAudioCard input").getBoundingClientRect().height > 400,
  );
  assert.equal((await native.boundingBox()).height, length);
});

test("haptics are opt-in, fullscreen/touch only, with persistent sensitivity and no polling pulses", async (t) => {
  const page = await fixture(t);
  await page.locator("#action").tap();
  assert.deepEqual(await page.evaluate(() => vibrations), []);
  await page.evaluate(() => (host.dataset.editing = "true"));
  await page.getByRole("checkbox", { name: "Fullscreen touch feedback" }).check();
  await page.waitForFunction(() => config.layout.hapticsEnabled === true);
  await page.locator("#deckHapticsSensitivity").fill("100");
  await page.waitForFunction(() => config.layout.hapticsSensitivity === 100);
  await page.evaluate(() => (host.dataset.focus = "true"));
  await page.locator("#action").tap();
  assert.equal(
    await page.evaluate(() => vibrations.filter((x) => x > 0).length),
    0,
    "editing never vibrates",
  );
  await page.evaluate(() => (host.dataset.editing = "false"));
  await page.evaluate(() => {
    document.getElementById("action").onclick = (event) => {
      actions++;
      event.currentTarget.disabled = true;
    };
  });
  await page.locator("#action").tap();
  await page.evaluate(() => {
    document.getElementById("action").disabled = false;
    document.getElementById("action").onclick = () => actions++;
  });
  assert.equal(await page.evaluate(() => vibrations.filter((x) => x > 0).length), 1);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    input.setPointerCapture = () => {};
    input.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", pointerId: 23 }));
    for (const value of [51, 52]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 23 }));
  });
  assert.equal(
    await page.evaluate(() => vibrations.filter((x) => x > 0).length),
    2,
    "slider changes accumulate to a detent",
  );
  const before = await page.evaluate(() => vibrations.length);
  await page.evaluate(() => control.sync(Number(input.value)));
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => vibrations.length),
    before,
    "external state updates do not vibrate",
  );
  await page.locator("#action").click();
  assert.equal(
    await page.evaluate(() => vibrations.length),
    before,
    "mouse input does not vibrate",
  );
  await page.getByRole("button", { name: "Increase Demo volume" }).tap();
  assert.equal(
    await page.evaluate(() => vibrations.filter((x) => x > 0).length),
    3,
    "a deliberate step tap gives feedback before reaching the next drag detent",
  );
  await page.evaluate(() => (host.dataset.focus = "false"));
  await page.locator("#action").tap();
  assert.equal(await page.evaluate(() => vibrations.filter((x) => x > 0).length), 3);
});

test("unsupported browsers show an honest disabled haptics option", async (t) => {
  const page = await fixture(t, { supported: false });
  await page.evaluate(() => (host.dataset.editing = "true"));
  assert.equal(
    await page.getByRole("checkbox", { name: "Fullscreen touch feedback" }).isDisabled(),
    true,
  );
  assert.match(
    await page.locator(".deckHapticsSettings p").textContent(),
    /does not offer vibration/,
  );
  await page.evaluate(() => {
    host.dataset.focus = "true";
    host.dataset.editing = "false";
  });
  await page.locator("#action").tap();
  assert.equal(await page.evaluate(() => actions), 1);
});
