const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const createCoreServer = require("../src/app/core/create-core-server");
const createFeaturePlatformExtension = require("../src/app/optional/create-feature-platform-extension");

for (const channel of ["ravelink-feature-ui-v1", "groby-feature-ui-v1"]) {
  test(`Twitch Client ID administration is write-only and gated by HUD Developer Mode (${channel})`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-twitch-ui-"));
    const installed = path.join(root, "installed", "twitch-integration");
    fs.cpSync(path.join(__dirname, "..", "features", "twitch-integration"), installed, {
      recursive: true,
    });
    if (channel === "groby-feature-ui-v1") {
      const filename = path.join(installed, "ui", "connection.html");
      const content = fs
        .readFileSync(filename, "utf8")
        .replaceAll("ravelink-feature-ui-v1", channel);
      fs.writeFileSync(filename, content);
      const manifestPath = path.join(installed, "groby.feature.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.integrity.files["ui/connection.html"] = require("node:crypto")
        .createHash("sha256")
        .update(content)
        .digest("hex");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    let pending = false;
    let connected = false;
    let invalidStatus = true;
    let createFailure = false;
    let recovery = {
      reauthorizationRequired: false,
      reason: "",
      revocations: [],
    };
    let monitorConfig = {
      intakeMode: "streamelements",
      songRequestChatEnabled: false,
    };
    let roleDirectory = { moderators: 0, vips: 0, updatedAt: 0, refreshing: false, lastError: "" };
    const managedRewards = [];
    const reviews = [
      {
        broadcasterId: "123",
        rewardId: "managed-song",
        redemptionId: "interrupted",
        phase: "review",
        desiredStatus: "",
        observedStatus: "",
        error: "twitch_interrupted_transaction",
        updatedAt: 1000,
      },
    ];
    const reconciled = [];
    const status = () => ({
      ok: true,
      configured: true,
      connected,
      authorizationRecovery: recovery,
      login: connected ? "tester" : "",
      userId: connected ? "123" : "",
      scopes: connected
        ? [
            "channel:manage:redemptions",
            "user:read:chat",
            "user:write:chat",
            "channel:read:vips",
            "moderation:read",
          ]
        : [],
      expiresAt: 0,
      authorizationPending: pending,
      userCode: pending ? "TEST-CODE" : "",
      verificationUri: pending ? "https://www.twitch.tv/activate?device-code=TEST-CODE" : "",
      nextPollAt: 0,
      authorizationExpiresAt: 0,
      requiredScopes: ["channel:manage:redemptions"],
      roleDirectory,
      managedRewards: structuredClone(managedRewards),
      monitorConfig: { ...monitorConfig },
      vault: "windows_dpapi",
      lastError: "",
    });
    const created = createCoreServer({
      rootDir: path.join(__dirname, ".."),
      runtimeDir: path.join(root, "runtime"),
      dryRun: true,
      capabilities: { features: true },
      extend: createFeaturePlatformExtension({
        featuresRoot: path.join(root, "installed"),
        runtimeRoot: path.join(root, "runtime", "features"),
        allowUnsafeRuntime: true,
        providers: {
          "twitch.host.v1/review-transactions": () => ({
            ok: true,
            total: reviews.length,
            entries: structuredClone(reviews),
          }),
          "twitch.host.v1/reconcile-transaction": (payload) => {
            reconciled.push(payload);
            reviews.splice(0);
            return { ok: true, status: payload.status };
          },
          "twitch.host.v1/status": () => (invalidStatus ? { ok: true } : status()),
          "twitch.host.v1/configure-monitor": (payload) => {
            monitorConfig = { ...payload };
            return status();
          },
          "twitch.host.v1/begin": () => {
            pending = true;
            return status();
          },
          "twitch.host.v1/poll": () => {
            pending = false;
            connected = true;
            return status();
          },
          "twitch.host.v1/create-reward": (payload) => {
            if (createFailure) return { ok: false, error: "twitch_reward_creation_in_progress" };
            const reward = {
              ok: true,
              purpose: payload.purpose,
              rewardId: `managed-${payload.purpose}`,
              title: payload.title,
              cost: payload.cost,
              manageable: true,
            };
            managedRewards.push(reward);
            return reward;
          },
        },
      }),
    });
    await created.extension.startup;
    const server = await new Promise((resolve) => {
      const listener = created.app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    let browser;
    t.after(async () => {
      if (browser) await browser.close();
      await created.extension.shutdown();
      await created.services.lifecycle.stopAll();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.context().route("https://www.twitch.tv/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Twitch authorization</title>",
      }),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, {
      waitUntil: "domcontentloaded",
    });
    const twitchTab = page.getByRole("button", { name: "TWITCH INTEGRATION" });
    await twitchTab.waitFor();
    await twitchTab.click();

    const contribution = page.frameLocator("iframe.featurePageFrame").frameLocator("#surface");
    const developerSection = contribution.locator("#developerApplication");
    await developerSection.waitFor({ state: "attached" });
    await contribution.locator("#state").filter({ hasText: "STATUS UNAVAILABLE" }).waitFor();
    assert.equal(await developerSection.isHidden(), true);
    const coreAccent = await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--accent").trim());
    const featureAccent = await contribution
      .locator("html")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--accent").trim());
    assert.equal(featureAccent, coreAccent);

    await page.locator("#themeButton").click();
    await page.locator("#developerMode").check();
    await developerSection.waitFor({ state: "visible" });
    assert.equal(await contribution.locator("#clientId").getAttribute("type"), "password");
    assert.equal(await contribution.getByText("SHOW CLIENT ID").count(), 0);
    assert.equal(await contribution.locator("#clearClientId").isDisabled(), true);
    await contribution.locator("#clientId").fill("syntheticclient123");
    assert.equal(await contribution.locator("#save").isDisabled(), true);
    await contribution.locator("#clientId").fill("");
    invalidStatus = false;
    await contribution.locator("#refresh").click();
    await contribution.locator("#state").filter({ hasText: "READY TO AUTHORIZE" }).waitFor();
    assert.equal(await contribution.locator("#clearClientId").isEnabled(), true);
    const popupPromise = page.context().waitForEvent("page");
    await contribution.locator("#begin").click();
    const popup = await popupPromise;
    await popup.waitForURL(/^https:\/\/www\.twitch\.tv\/activate\?device-code=TEST-CODE/);
    assert.match(popup.url(), /^https:\/\/www\.twitch\.tv\/activate\?device-code=TEST-CODE/);
    await popup.close();
    await contribution.locator("#check").click();
    await contribution.locator("#state").filter({ hasText: "CONNECTED" }).waitFor();
    assert.equal(
      await contribution
        .locator(".task-navigation")
        .getByRole("button", { name: "Event intake", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await contribution
        .locator(".task-navigation")
        .getByRole("button", { name: "Rewards", exact: true })
        .count(),
      0,
    );
    assert.match(await contribution.locator("#roleDirectory").textContent(), /synchronizing/);
    roleDirectory = { moderators: 32, vips: 36, updatedAt: 1, refreshing: false, lastError: "" };
    await contribution.locator("#refresh").click();
    await contribution
      .locator("#roleDirectory")
      .filter({ hasText: "32 moderators / 36 VIPs" })
      .waitFor({ state: "attached" });
    await contribution
      .locator(".task-navigation")
      .getByRole("button", { name: "Review", exact: true })
      .click();
    await contribution.getByRole("button", { name: "REFUND POINTS", exact: true }).click();
    await contribution
      .locator("#transactionNotice")
      .filter({ hasText: "Twitch confirms CANCELED." })
      .waitFor();
    assert.equal(reconciled[0].status, "CANCELED");
    recovery = { reauthorizationRequired: true, reason: "authorization_revoked", revocations: [] };
    connected = false;
    await contribution
      .locator(".task-navigation")
      .getByRole("button", { name: "Connection", exact: true })
      .click();
    await contribution.locator("#refresh").click();
    await contribution.locator("#state").filter({ hasText: "RECONNECT REQUIRED" }).waitFor();
    assert.equal(await contribution.locator("#begin").isEnabled(), true);
    for (const viewport of [
      { width: 1280, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      assert.ok(
        await contribution.locator("body").evaluate((el) => el.scrollWidth <= innerWidth + 1),
      );
    }
    await contribution.locator("body").evaluate((body) => {
      const spacer = document.createElement("div");
      spacer.id = "long-content-fixture";
      spacer.style.height = "18000px";
      body.append(spacer);
    });
    await page.waitForFunction(
      () =>
        document.querySelector("iframe.featurePageFrame").getBoundingClientRect().height > 18000,
    );
    assert.ok(
      await contribution
        .locator("body")
        .evaluate((body) => body.getBoundingClientRect().height <= innerHeight + 1),
    );
    await contribution.locator("#long-content-fixture").evaluate((node) => node.remove());
    assert.deepEqual(errors, []);
  });
}

test("Twitch permission choices stay distinct from actual grants and identity-only authorization", async (t) => {
  const express = require("express");
  const present = require("../src/capabilities/feature-platform/http/feature-presentation");
  const {
    GROUPS,
  } = require("../src/capabilities/feature-platform/providers/twitch-permission-groups");
  const app = express();
  app.use(require("./support/fixture-http-limit.cjs")());
  app.get("/connection", (_req, res) =>
    res
      .type("html")
      .send(
        present(
          fs.readFileSync(
            path.join(__dirname, "../features/twitch-integration/ui/connection.html"),
            "utf8",
          ),
        ),
      ),
  );
  app.get("/", (_req, res) =>
    res.type("html")
      .send(`<!doctype html><html><body style="margin:0;background:#0b0e18"><iframe id="ui" title="Twitch" src="/connection" style="width:100%;border:0"></iframe><script>
    window.groups=${JSON.stringify(GROUPS)};
    window.calls=[];window.connected=true;window.pending=false;
    window.selected=groups.map(g=>g.id);window.granted=['user:read:chat'];
    function status(){return {ok:true,configured:true,connected,authorizationPending:pending,userCode:pending?'TEST-CODE':'',verificationUri:pending?'https://www.twitch.tv/activate?device-code=TEST-CODE':'',login:'fixture',grantedScopes:[...granted],selectedPermissionGroups:[...selected],requestedScopes:groups.filter(g=>selected.includes(g.id)).flatMap(g=>g.scopes),permissionGroups:groups.map(g=>({...g,selected:selected.includes(g.id),granted:g.scopes.every(s=>granted.includes(s)),available:connected&&g.scopes.every(s=>granted.includes(s)),missingScopes:g.scopes.filter(s=>!granted.includes(s))})),managedRewards:[],monitorConfig:{intakeMode:'native',songRequestChatEnabled:false}};}
    addEventListener('message',event=>{
      if(event.source!==document.querySelector('#ui').contentWindow||event.data?.channel!=='ravelink-feature-ui-v1')return;
      const m=event.data;
      if(m.type==='feature-height'){document.querySelector('#ui').style.height=m.height+'px';return;}
      if(m.type!=='call')return;calls.push({capability:m.capability,method:m.method,payload:m.payload});
      if(m.capability==='twitch.oauth.admin.v1'&&m.method==='configure'){selected=[...m.payload.permissionGroups];pending=false;}
      if(m.capability==='twitch.oauth.admin.v1'&&m.method==='begin'){selected=[...m.payload.permissionGroups];pending=true;}
      if(m.capability==='twitch.oauth.admin.v1'&&m.method==='poll'){granted=groups.filter(g=>selected.includes(g.id)).flatMap(g=>g.scopes);pending=false;connected=true;}
      const value=m.method==='review'?{ok:true,entries:[],total:0}:status();
      event.source.postMessage({channel:m.channel,id:m.id,ok:true,value},'*');
    });
    </script></body></html>`),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
  const frame = page.frameLocator("#ui");
  await frame.locator("#permissionGroups input").nth(4).waitFor();
  assert.equal(await frame.locator("#permissionGroups input").count(), GROUPS.length);
  assert.match(
    await frame.locator("#permissionSummary").textContent(),
    new RegExp("1 of " + GROUPS.length + " features available now"),
  );
  assert.equal(await frame.locator('[data-permission="clips"] input').isChecked(), true);
  assert.equal(
    await frame.locator('[data-permission="clips"] .badge').textContent(),
    "Needs authorization",
  );
  assert.equal(
    await frame.locator('[data-permission="chat-read"] .badge').textContent(),
    "Granted",
  );
  assert.equal(await frame.locator("#createReward").isDisabled(), true);
  assert.match(
    await frame.locator("#chatAccessNotice").textContent(),
    /replies and clip links cannot be posted/,
  );
  const size = await frame.locator('[data-task-panel="Connection"]').first().boundingBox();
  assert.ok(size.height < 570, "desktop connection permission panel stays compact");
  assert.equal(
    await frame.locator("#activation").evaluate((el) => el.getBoundingClientRect().height),
    0,
  );
  assert.equal(
    await frame
      .locator("#developerApplication")
      .evaluate((el) => el.getBoundingClientRect().height),
    0,
  );
  assert.equal(
    await frame.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(11, 14, 24)",
  );
  await frame.locator("#uncheckPermissions").click();
  await frame.locator("#checkPermissions").click();
  assert.equal(await frame.locator("#permissionGroups input:checked").count(), GROUPS.length);
  assert.equal(await frame.locator("#checkPermissions").isDisabled(), true);
  await frame.locator("#uncheckPermissions").click();
  assert.equal(await frame.locator("#permissionGroups input:checked").count(), 0);
  await frame.locator("#savePermissions").click();
  await frame
    .locator("#notice")
    .filter({ hasText: "Current granted access has not changed" })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => calls.find((c) => c.method === "configure").payload), {
    permissionGroups: [],
  });
  assert.equal(
    await frame.locator('[data-permission="chat-read"] .badge').textContent(),
    "Granted",
    "saving unchecked choices does not pretend to revoke a token",
  );
  assert.match(await frame.locator("#permissionSummary").textContent(), /Identity-only/);
  await frame.locator("#begin").click();
  await frame.locator("#activation").waitFor({ state: "visible" });
  assert.deepEqual(await page.evaluate(() => calls.find((c) => c.method === "begin").payload), {
    permissionGroups: [],
  });
  assert.equal(await frame.locator("#begin").isDisabled(), true);
  await frame.locator('[data-permission="clips"] input').check();
  assert.equal(
    await frame.locator("#begin").isDisabled(),
    false,
    "pending login can be replaced after choosing different permissions",
  );
  await frame.locator("#cancelAuthorization").click();
  await frame.locator("#activation").waitFor({ state: "hidden" });
  assert.equal(
    await frame.locator('[data-permission="chat-read"] .badge').textContent(),
    "Granted",
    "cancelling a new login preserves existing access",
  );
  await frame.locator('[data-permission="clips"] input').uncheck();
  await frame.locator("#savePermissions").click();
  await frame.locator("#begin").click();
  await frame.locator("#check").click();
  await frame.locator("#activation").waitFor({ state: "hidden" });
  assert.equal(
    await frame.locator('[data-permission="chat-read"] .badge').textContent(),
    "Needs authorization",
  );
  assert.equal(await frame.locator("#createReward").isDisabled(), true);
  await page.evaluate(() => {
    granted = ["channel:manage:redemptions"];
  });
  await frame.locator("#refresh").click();
  await frame
    .locator('[data-permission="rewards"] .badge')
    .filter({ hasText: "Granted" })
    .waitFor();
  assert.equal(
    await frame.locator("#createReward").isEnabled(),
    true,
    "actual rewards grants remain usable even when not selected for the next authorization",
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1100, height: 850 },
  ]) {
    await page.setViewportSize(viewport);
    await frame
      .locator("body")
      .evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    assert.equal(
      await frame
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  assert.deepEqual(errors, []);
});
