const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  path = require("node:path"),
  { chromium } = require("playwright");

test("pill inputs preserve whole phrases, paste lists atomically, enforce limits and support keyboard and touch removal", async (t) => {
  const app = express();
  app.use(express.static(path.join(__dirname, "../public/core")));
  app.get("/test-pills", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pill-input.css"><style>body{font:16px Arial;background:#0b0e18;color:#eee;margin:12px}label{display:block}</style><form id="form"><label for="words">Phrases</label><input id="words" placeholder="Add a phrase"><button id="save">Save</button></form><script type="module">import {createPillInput} from '/pill-input.js';window.pills=createPillInput(document.querySelector('#words'),{label:'Phrases',maxItems:3,maxLength:80,normalize:s=>s.trim().toLowerCase()});window.saves=0;document.querySelector('#form').onsubmit=e=>{e.preventDefault();window.saves++;window.saved=window.pills.read()};</script>`,
      ),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = "http://127.0.0.1:" + server.address().port,
    page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/test-pills");
  await page.waitForFunction(() => !!window.pills);
  const input = page.locator("#words");
  assert.ok((await page.locator(".pillInput").evaluate((el) => el.clientHeight)) < 50);
  await input.fill("Hello there, friend!");
  await input.press("Enter");
  assert.equal(await page.locator(".pillTokens li").textContent(), "hello there, friend!\u00d7");
  assert.equal(await page.evaluate(() => window.saves), 0, "Enter adds, never submits the form");
  await input.fill("HELLO THERE, FRIEND!");
  await input.press("Enter");
  assert.equal(await page.locator(".pillToken").count(), 1);
  await input.fill("composing");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(await input.inputValue(), "composing");
  assert.equal(await page.locator(".pillToken").count(), 1);
  await input.fill("");
  const paste = (text) =>
    input.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  await paste("two words\nthird phrase");
  assert.equal(await page.locator(".pillToken").count(), 3);
  await paste("fourth\nfifth");
  assert.equal(await page.locator(".pillToken").count(), 3, "over-limit paste changes nothing");
  assert.match(await page.locator("#wordsError").textContent(), /at most 3/);
  await input.press("Backspace");
  assert.equal(await page.locator(".pillToken").count(), 2);
  await input.press("Backslash");
  assert.equal(await page.locator(".pillToken").count(), 1);
  await input.press("ArrowLeft");
  assert.equal(
    await page
      .getByRole("button", { name: "Remove hello there, friend!", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Delete");
  assert.equal(await page.locator(".pillToken").count(), 0);
  await paste("x".repeat(81) + "\nvalid phrase");
  assert.equal(await page.locator(".pillToken").count(), 0);
  assert.match(await page.locator("#wordsError").textContent(), /80 characters/);
  await input.fill('<img src=x onerror="window.unsafe=true">');
  await input.press("Enter");
  assert.equal(await page.locator(".pillInput img").count(), 0);
  assert.equal(await page.evaluate(() => window.unsafe), undefined);
  await page.getByRole("button", { name: /Remove <img/ }).click();
  await input.fill("still typing");
  await page.locator("#save").click();
  assert.deepEqual(await page.evaluate(() => window.saved), ["still typing"]);
  assert.equal(
    await page.locator(".pillRemove").evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  await page.locator(".pillToken").hover();
  assert.equal(
    await page.locator(".pillRemove").evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.goto(base + "/test-pills");
  await phone.waitForFunction(() => !!window.pills);
  await phone.locator("#words").fill("touch friendly");
  await phone.locator("#words").press("Enter");
  assert.equal(
    await phone.locator(".pillRemove").evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  assert.ok((await phone.locator(".pillRemove").evaluate((el) => el.clientWidth)) >= 40);
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await phone.locator(".pillRemove").tap();
  assert.equal(await phone.locator(".pillToken").count(), 0);
  assert.deepEqual(errors, []);
});
