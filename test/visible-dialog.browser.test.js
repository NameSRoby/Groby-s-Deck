const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  express = require("express"),
  { chromium } = require("playwright");

test("confirmation stays in the real viewport of nested tall frames, follows resize/scroll and returns focus without deleting", async (t) => {
  const app = express(),
    script = fs
      .readFileSync(path.join(__dirname, "../public/core/visible-dialog.js"), "utf8")
      .replace(/export function /g, "function "),
    css = fs.readFileSync(path.join(__dirname, "../public/core/visible-dialog.css"), "utf8");
  app.get("/child", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><style>${css}body{margin:0;min-height:18000px;font:16px Arial}#remove{position:absolute;top:12000px;left:40px}dialog{padding:24px;background:#121a2a;color:white;border:1px solid #394762;border-radius:12px}.toolbar{display:flex;gap:10px;flex-wrap:wrap}button{padding:10px}</style><button id="remove">Remove example</button><dialog id="confirm" aria-labelledby="heading"><div class="visibleDialogContent"><h2 id="heading">Remove example?</h2><p id="text">This cannot be undone.</p></div><div class="toolbar"><button id="cancel" autofocus>Cancel</button><button id="delete">Delete</button></div></dialog><script>${script};const modal=createVisibleDialog(document.querySelector('#confirm'));window.deletes=0;document.querySelector('#remove').onclick=()=>modal.open();document.querySelector('#cancel').onclick=()=>document.querySelector('#confirm').close();document.querySelector('#delete').onclick=()=>{window.deletes++;document.querySelector('#confirm').close()};</script>`,
      ),
  );
  app.get("/shell", (_req, res) =>
    res
      .type("html")
      .send(
        '<!doctype html><style>html,body{margin:0}iframe{display:block;border:0;width:100%;height:18000px}</style><iframe id="surface" sandbox="allow-scripts" src="/child"></iframe>',
      ),
  );
  app.get("/", (_req, res) =>
    res
      .type("html")
      .send(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:64px;background:black;color:white;z-index:20}iframe{display:block;width:100%;height:18000px;border:0;margin-top:64px}</style><header>App navigation</header><iframe id="feature" src="/shell"></iframe>',
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
  const page = await browser.newPage({ viewport: { width: 1426, height: 1000 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const frame = page.frameLocator("#feature").frameLocator("#surface"),
    remove = frame.locator("#remove"),
    dialog = frame.locator("#confirm");
  const fits = async () => {
    const box = await dialog.boundingBox(),
      size = page.viewportSize();
    return (
      !!box &&
      box.x >= 8 &&
      box.y >= 8 &&
      box.x + box.width <= size.width - 8 &&
      box.y + box.height <= size.height - 8
    );
  };
  const untilFits = async () => {
    for (let n = 0; n < 60; n++) {
      if (await fits()) return;
      await page.waitForTimeout(16);
    }
    assert.fail(
      "Dialog left the visible app viewport: " + JSON.stringify(await dialog.boundingBox()),
    );
  };
  await remove.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  assert.ok(before > 10000);
  await remove.click();
  await frame.locator("#confirm[open]").waitFor();
  await untilFits();
  assert.equal(
    await page.evaluate(() => scrollY),
    before,
    "opening does not jump to the iframe's center",
  );
  assert.equal(
    await frame.locator("#cancel").evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await remove.evaluate((el) => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => scrollY), before);
  await remove.click();
  await frame.locator("#confirm[open]").waitFor();
  await untilFits();
  await page.setViewportSize({ width: 390, height: 600 });
  await untilFits();
  await page.evaluate(() => scrollBy(0, 650));
  await untilFits();
  await frame
    .locator("#text")
    .evaluate((el) => (el.textContent = "Long confirmation text. ".repeat(250)));
  await untilFits();
  const cancel = await frame.locator("#cancel").boundingBox();
  assert.ok(
    cancel.y >= 8 && cancel.y + cancel.height <= 592,
    "buttons stay visible with long text",
  );
  await frame.locator("#cancel").click();
  assert.equal(await frame.locator("body").evaluate(() => window.deletes), 0);
  assert.deepEqual(errors, []);
});
