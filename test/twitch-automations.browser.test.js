/** Exercise the shipped sandbox page and shared editor with synthetic owners. */
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright"),
  fixture = require("./support/twitch-automation-fixture.cjs"),
  { until } = fixture;
async function setup(t, syntax = false, quotes = false, category = "reward") {
  const f = fixture(t),
    errors = [],
    html = fs.readFileSync(
      path.join(
        __dirname,
        syntax === "command-list"
          ? "../features/twitch-integration/ui/command-list.html"
          : syntax === "watchtime"
            ? "../features/twitch-integration/ui/watchtime.html"
            : quotes
              ? "../features/twitch-integration/ui/quotes.html"
              : syntax
                ? "../features/twitch-integration/ui/syntax.html"
                : "../features/twitch-integration/ui/automations.html",
      ),
    );
  const server = http.createServer(async (req, res) => {
    if (req.url === "/panel") {
      res.setHeader("content-type", "text/html");
      res.end(html);
      return;
    }
    if (req.url === "/bridge") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try {
        const input = JSON.parse(raw);
        if (
          ![
            "twitch.automations.v1",
            "twitch.connection.read.v1",
            "twitch.monitor.admin.v1",
          ].includes(input.capability)
        )
          throw Error("capability invalid");
        let value;
        if (input.capability === "twitch.connection.read.v1")
          value = {
            ...f.provider.status(),
            monitorConfig: f.intakeConfig || {
              intakeMode: "native",
              songRequestChatEnabled: false,
            },
          };
        else if (input.capability === "twitch.monitor.admin.v1") {
          f.intakeConfig = input.payload;
          value = { ...f.provider.status(), monitorConfig: f.intakeConfig };
        } else if (input.method === "rewards") value = { ok: true, rewards: f.rewards };
        else
          value = await f.automations[
            {
              "community-preview": "communityPreview",
              "community-import": "communityImport",
              "community-quotes": "communityQuotes",
              "community-tracking": "communityTracking",
            }[input.method] || input.method
          ](input.payload);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, value }));
      } catch (error) {
        res.end(JSON.stringify({ ok: false, error: error.code || error.message }));
      }
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<html><body><iframe sandbox="allow-scripts" title="Automations" src="/panel" style="width:100%;height:100vh;border:0"></iframe><script>const frame=document.querySelector('iframe');window.addEventListener('message',async event=>{if(event.source!==frame.contentWindow||event.data.type!=='call')return;const response=await fetch('/bridge',{method:'POST',body:JSON.stringify(event.data)}).then(r=>r.json());frame.contentWindow.postMessage({...response,id:event.data.id,channel:event.data.channel},"*");});</script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(7000);
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(errors, []);
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  const panel = page.frameLocator("iframe");
  if (syntax === "command-list") await panel.locator(".commandListChoice").first().waitFor();
  else if (syntax === "watchtime")
    await panel.locator("#status").filter({ hasText: "saved records" }).waitFor();
  else if (quotes) await panel.locator("#quoteRefresh").waitFor();
  else if (syntax) await panel.locator("#variableTable .variableRow:visible").first().waitFor();
  else await panel.locator("#notice").filter({ hasText: "Ready." }).waitFor();
  if (!syntax && !quotes && category)
    await panel.locator(`[data-automation-category="${category}"]`).click();
  return { ...f, page, panel };
}
test("Syntax page searches functions and previews messages, random choices and counters without side effects", async (t) => {
  const f = await setup(t, true),
    { panel } = f;
  assert.equal(await panel.locator("#examplesPanel").isVisible(), false);
  assert.deepEqual(await panel.locator("#variableTable thead th").allTextContents(), [
    "Variable",
    "What it does",
  ]);
  assert.equal(await panel.locator("#variableTable button, #variableTable textarea").count(), 0);
  await panel.locator("#search").fill("weighted");
  assert.equal(await panel.locator(".variableRow").count(), 1);
  assert.match(await panel.locator(".variableRow th").textContent(), /\$\{weighted/);
  await panel.locator("#variableCategory").selectOption("People");
  assert.equal(await panel.locator("#noVariables").isVisible(), true);
  await panel.locator("#search").fill("");
  assert.ok((await panel.locator(".variableRow").count()) >= 4);
  assert.equal(
    await panel.locator("#variableTable").getByText("${sender}", { exact: true }).isVisible(),
    true,
  );
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await panel.locator("#examplesTab").click();
  assert.equal(await panel.locator("#variablesPanel").isVisible(), false);
  await f.page.evaluate(() =>
    document
      .querySelector("iframe")
      .contentWindow.postMessage({ channel: "groby-feature-ui-v1", type: "theme" }, "*"),
  );
  await panel
    .locator("#template")
    .fill("${sender}: ${count[deaths]} / ${target.game} / ${target.link}");
  await panel.locator("#preview").click();
  await panel
    .locator("#result")
    .filter({ hasText: "sample_viewer: 1 / Sample category / https://www.twitch.tv/sample_target" })
    .waitFor();
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  assert.equal(f.calls.length, 0);
  await panel.locator("#template").fill("${chance[100|Guaranteed|No]}");
  await panel.locator("#preview").click();
  await panel.locator("#result").filter({ hasText: "Guaranteed" }).waitFor();
  await panel.locator("#template").fill("${chance[999|a|b]}");
  await panel.locator("#preview").click();
  await panel.locator("#result").filter({ hasText: "Chance must be" }).waitFor();
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await panel.locator("#examplesTab").focus();
  await panel.locator("#examplesTab").press("ArrowLeft");
  assert.equal(await panel.locator("#manualTab").getAttribute("aria-selected"), "true");
  await panel.locator("#manualTab").press("ArrowLeft");
  assert.equal(await panel.locator("#variablesTab").getAttribute("aria-selected"), "true");
  assert.equal(await panel.locator("#examplesPanel").isVisible(), false);
  await panel.locator("#variablesTab").press("End");
  assert.equal(await panel.locator("#template").inputValue(), "${chance[999|a|b]}");
});

test("the language manual explains operators, fits a phone and previews both sides of a worked condition", async (t) => {
  const f = await setup(t, true),
    { panel } = f;
  await panel.getByRole("tab", { name: "Language manual", exact: true }).click();
  assert.equal(await panel.locator("#variableTable").isVisible(), false);
  const comparisons = panel.getByRole("table", { name: "Compare two numbers", exact: true });
  for (const operator of ["==", "!=", ">", "<", ">=", "<="])
    assert.equal(await comparisons.getByText(operator, { exact: true }).isVisible(), true);
  assert.match(await comparisons.textContent(), /Equality does not count/);
  assert.match(await panel.locator("#manual-logic").textContent(), /both must be true/);
  assert.match(
    await panel.locator("#manual-calculations").textContent(),
    /rather than a percentage/,
  );
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  for (const [roll, outcome] of [
    ["18", "Success! The shield breaks."],
    ["9", "Failed! The shield holds."],
  ]) {
    await panel.locator("#manualTab").click();
    await panel.locator(`[data-manual-roll="${roll}"]`).click();
    assert.equal(await panel.locator("#examplesTab").getAttribute("aria-selected"), "true");
    await panel.locator("#preview").click();
    await panel.locator("#result").filter({ hasText: outcome }).waitFor();
    assert.match(
      await panel.locator("#result").textContent(),
      new RegExp("rolled " + roll + "/20"),
    );
  }
  await panel.getByText("Quick reference: the patterns to remember", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Explain conditions and calculations", exact: true })
    .click();
  assert.equal(await panel.locator("#manualTab").getAttribute("aria-selected"), "true");
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  assert.equal(f.calls.length, 0);
});

test("command highlighting preserves native editing, programmatic changes, scroll alignment and safe text on touch screens", async (t) => {
  const f = await setup(t, true),
    { panel } = f;
  await panel.locator("#examplesTab").click();
  const input = panel.locator("#template"),
    painted = panel.locator("#template").locator("..").locator(".commandCodeHighlight");
  const source =
    '${set roll 18}\n${if roll >= 16}${random.pick "Hit ${user}!" "Miss"}${else}No${end}';
  await input.fill(source);
  await painted.locator(".commandToken-function").filter({ hasText: "random.pick" }).waitFor();
  const colors = await painted.evaluate((el) =>
    ["flow", "function", "variable", "number", "string", "operator"].map(
      (kind) => getComputedStyle(el.querySelector(".commandToken-" + kind)).color,
    ),
  );
  assert.equal(new Set(colors).size, colors.length);
  await input.press("Control+End");
  await input.press("!");
  assert.equal(await input.inputValue(), source + "!");
  await input.press("Control+z");
  assert.equal(await input.inputValue(), source);
  await input.evaluate((el) => {
    el.setSelectionRange(0, 6);
  });
  assert.equal(
    await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd)),
    source.slice(0, 6),
  );
  await panel.locator("#counter").click();
  await painted
    .locator(".commandToken-function")
    .filter({ hasText: /^countadddeath$/ })
    .waitFor();
  const long =
    Array.from(
      { length: 90 },
      (_, n) =>
        "Line " + n + ': ${sender} ${set roll 18} <img src=x onerror="window.injected=true">',
    ).join("\n") + "\n";
  await input.fill(long);
  await input.evaluate((el) => {
    el.style.height = "130px";
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await f.page.setViewportSize({ width: 390, height: 844 });
  await input.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const metrics = await input.evaluate((el) => {
    const pre = el.parentElement.querySelector("pre");
    return {
      inputTop: el.scrollTop,
      paintTop: pre.scrollTop,
      inputHeight: el.scrollHeight,
      paintHeight: pre.scrollHeight,
      injected: window.injected,
      tags: pre.querySelectorAll("img").length,
    };
  });
  assert.ok(Math.abs(metrics.inputHeight - metrics.paintHeight) <= 1, JSON.stringify(metrics));
  assert.ok(Math.abs(metrics.inputTop - metrics.paintTop) <= 1, JSON.stringify(metrics));
  assert.equal(metrics.tags, 0);
  assert.equal(metrics.injected, undefined);
  assert.equal(await input.inputValue(), long);
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await input.dispatchEvent("compositionstart");
  assert.equal(await input.locator("..").getAttribute("data-plain"), "true");
  await input.dispatchEvent("compositionend");
  assert.equal(await input.locator("..").getAttribute("data-plain"), "false");
  await panel.getByRole("button", { name: "Syntax colors", exact: true }).first().click();
  assert.equal(await input.locator("..").getAttribute("data-plain"), "true");
  await f.page.emulateMedia({ forcedColors: "active" });
  assert.notEqual(
    await input.evaluate((el) => getComputedStyle(el).webkitTextFillColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(f.calls.length, 0);
});

test("automation creation colors chat, announcement and recipe syntax, inserts variables and preserves the saved flow", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Colored command");
  await panel.locator("#triggerType").selectOption("command");
  await panel.locator("#command").fill("!colors");
  for (const [index, action] of ["chat", "announcement", "recipe"].entries()) {
    await panel.locator("#actionChoice").selectOption("twitch.action." + action);
    await panel.locator("#addAction").click();
    const input = panel.locator('[data-deck-parameter="message"]').nth(index);
    await input.fill('${set roll 18}${if roll >= 16}"Hello" ${sender}${else}No${end}');
    await input.locator("..").locator(".commandToken-flow").filter({ hasText: "if" }).waitFor();
    assert.ok((await input.locator("..").locator(".commandToken-variable").count()) > 0);
  }
  const first = panel.locator('[data-deck-parameter="message"]').first();
  await first.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await panel.getByText("Insert variable", { exact: true }).first().click();
  await panel.getByRole("button", { name: "Person speaking", exact: true }).first().click();
  assert.ok((await first.inputValue()).endsWith("${sender}"));
  const text = await first.inputValue();
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const saved = f.automations.status().rows.find((row) => row.trigger.command === "!colors");
  assert.equal(saved.steps[0].params.message, text);
  assert.equal(saved.steps.length, 3);
  await panel
    .locator(".automationItem")
    .filter({ hasText: "Colored command" })
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await panel
    .locator(".automationItem")
    .filter({ hasText: "Colored command" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  assert.equal(await panel.locator('[data-deck-parameter="message"]').first().inputValue(), text);
  await panel.locator(".commandCodeHighlight .commandToken-function").first().waitFor();
  await f.page.setViewportSize({ width: 390, height: 844 });
  // ResizeObserver updates the native editor's painted layer after layout.
  await panel.locator("body").evaluate(async () => {
    const deadline = performance.now() + 2000;
    while (document.documentElement.scrollWidth > innerWidth && performance.now() < deadline)
      await new Promise(requestAnimationFrame);
  });
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.equal(f.calls.length, 0);
});

test("quote import has its own page, previews copied rows, preserves edits and excludes metadata", async (t) => {
  const f = await setup(t, false, true),
    { panel } = f;
  await panel.locator("#quoteImport > summary").click();
  await panel
    .locator("#source")
    .fill(
      "#35\nA copied quote\n3 weeks ago\tA game\tsome_viewer\n#34\nAnother copied quote\nOct 2025\tAnother game\tother_viewer",
    );
  await panel.locator("#preview").click();
  await panel.locator("#status").filter({ hasText: "2 new quotes ready" }).waitFor();
  assert.equal(await panel.locator("#rows tr").count(), 2);
  assert.match(await panel.locator("#rows tr").first().textContent(), /Source #34/);
  await panel.locator("#rows textarea").first().fill("An edited quote");
  assert.equal(await panel.locator("#apply").isDisabled(), true);
  await panel.locator("#preview").click();
  await panel.locator("#status").filter({ hasText: "2 new quotes ready" }).waitFor();
  assert.equal(await panel.locator("#rows textarea").first().inputValue(), "An edited quote");
  await panel.locator("#apply").click();
  await panel.locator("#status").filter({ hasText: "2 quotes imported" }).waitFor();
  const saved = JSON.parse(fs.readFileSync(f.file.replace(".json", ".community.json"), "utf8"))
    .accounts["123"].quotes;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].text, "An edited quote");
  assert.equal(saved[0].category, "Another game");
  await panel.locator("#preview").click();
  await panel
    .locator("#status")
    .filter({ hasText: "0 new quotes ready; 2 already saved" })
    .waitFor();
  assert.equal(await panel.locator("#apply").isDisabled(), true);
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
});

test("new ad reward automation saves without executing an ad", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Start an AD");
  assert.equal(await panel.locator("#rewardTitle").isVisible(), true);
  await panel.locator("#rewardTitle").fill("Start an AD");
  await panel.locator("#cost").fill("2500");
  await panel.locator("#prompt").fill("A fixture prompt");
  await panel.locator("#rewardCooldown").fill("1800");
  await panel.locator("#actionChoice").selectOption("twitch.action.commercial");
  await panel.locator("#addAction").click();
  await panel.locator("#save").click();
  await panel
    .locator("#notice")
    .filter({ hasText: "Twitch reward created and connected." })
    .waitFor();
  const saved = f.automations.status().rows.find((row) => row.name === "Start an AD");
  assert.equal(saved.steps[0].params.length, 30);
  assert.ok(saved.trigger.rewardId);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].operation, "create");
  assert.equal(f.writes[0].cost, 2500);
  assert.equal(f.writes[0].cooldownSeconds, 1800);
  assert.equal(f.calls.length, 0);
});

test("cooldown units preserve durations and save seconds for rewards and chat commands", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Unit reward");
  await panel.locator("#handler").selectOption("lights");
  await panel.locator("#rewardCooldownUnit").selectOption("3600");
  await panel.locator("#rewardCooldown").fill("1.5");
  await panel.locator("#rewardCooldownUnit").selectOption("1");
  assert.equal(await panel.locator("#rewardCooldown").inputValue(), "5400");
  await panel.locator("#rewardCooldownUnit").selectOption("60");
  assert.equal(await panel.locator("#rewardCooldown").inputValue(), "90");
  await panel.locator("#save").click();
  await panel
    .locator("#notice")
    .filter({ hasText: "Twitch reward created and connected." })
    .waitFor();
  assert.equal(f.writes.at(-1).cooldownSeconds, 5400);
  assert.equal(await panel.locator("#rewardCooldown").inputValue(), "90");
  assert.equal(await panel.locator("#rewardCooldownUnit").inputValue(), "60");
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Unit command");
  await panel.locator("#triggerType").selectOption("command");
  await panel.locator("#command").fill("!units");
  await panel.locator("#actionChoice").selectOption("twitch.action.chat");
  await panel.locator("#addAction").click();
  await panel.locator('[data-deck-parameter="message"]').fill("Fixture reply");
  await panel.locator("#cooldownUnit").selectOption("60");
  await panel.locator("#cooldown").fill("15");
  await panel.locator("#userCooldownUnit").selectOption("3600");
  await panel.locator("#userCooldown").fill("0.5");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const saved = f.automations.status().rows.find((row) => row.trigger.command === "!units");
  assert.equal(saved.cooldownSeconds, 900);
  assert.equal(saved.userCooldownSeconds, 1800);
  const revision = f.automations.status().revision;
  await panel.locator("#cooldownUnit").selectOption("1");
  await panel.locator("#cooldown").fill("0.5");
  await panel.locator("#save").click();
  await panel.locator("#editorNotice").filter({ hasText: "whole seconds" }).waitFor();
  assert.equal(f.automations.status().revision, revision);
});

test("combined reward save keeps the draft after a Twitch failure and retries without duplicate creation", async (t) => {
  const f = await setup(t),
    { panel } = f,
    create = f.provider.createReward;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Fixture reward");
  await panel.locator("#handler").selectOption("lights");
  await panel.locator("#cost").fill("450");
  assert.equal(await panel.locator("#rewardTitle").inputValue(), "Fixture reward");
  assert.equal(await panel.locator("#writeReward").count(), 0);
  f.provider.createReward = async () => ({ ok: false, error: "twitch_scope_missing" });
  await panel.locator("#save").click();
  await panel.locator("#editorNotice").filter({ hasText: "could not be created" }).waitFor();
  assert.equal(await panel.locator("#cost").inputValue(), "450");
  assert.equal(f.writes.length, 0);
  const savedId = f.automations.status().rows.find((row) => row.name === "Fixture reward").id;
  f.provider.createReward = create;
  await panel.locator("#save").evaluate((button) => {
    button.click();
    button.click();
  });
  await panel
    .locator("#editorNotice")
    .filter({ hasText: "Twitch reward created and connected" })
    .waitFor();
  assert.equal(f.writes.length, 1);
  const created = f.automations.status().rows.filter((row) => row.name === "Fixture reward");
  assert.equal(created.length, 1);
  assert.equal(created[0].id, savedId);
  assert.ok(created[0].trigger.rewardId);
  await panel.locator("#name").fill("Corrected reward name");
  assert.equal(await panel.locator("#rewardTitle").inputValue(), "Corrected reward name");
  await panel.locator("#cost").fill("600");
  await panel.locator("#save").click();
  await panel
    .locator("#editorNotice")
    .filter({ hasText: "Automation and Twitch reward saved" })
    .waitFor();
  assert.deepEqual(
    f.writes.map((row) => row.operation),
    ["create", "update"],
  );
  assert.equal(f.writes[1].cost, 600);
  assert.equal(f.writes[1].title, "Corrected reward name");
  assert.equal(
    f.automations.status().rows.find((row) => row.id === savedId).name,
    "Corrected reward name",
  );
  assert.equal(f.calls.length, 0);
});

test("an unconfirmed reward result requires refresh and recovers its binding before the next save", async (t) => {
  const f = await setup(t),
    { panel, page } = f;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Unconfirmed fixture");
  await panel.locator("#handler").selectOption("lights");
  await page.route("**/bridge", async (route) => {
    const input = route.request().postDataJSON();
    if (input.method !== "reward") return route.continue();
    await route.fetch();
    await route.fulfill({ json: { ok: false, error: "twitch_automation_response_unknown" } });
  });
  await panel.locator("#save").click();
  await panel.locator("#editorNotice").filter({ hasText: "Refresh to check" }).waitFor();
  assert.equal(await panel.locator("#save").isDisabled(), true);
  assert.equal(f.writes.filter((row) => row.operation === "create").length, 1);
  await page.unroute("**/bridge");
  await panel.locator("#refresh").click();
  await panel.locator("#notice").filter({ hasText: "Ready." }).waitFor();
  const bound = await panel.locator("#rewardId").inputValue();
  assert.ok(bound);
  await panel.locator("#save").click();
  await panel
    .locator("#editorNotice")
    .filter({ hasText: "Automation and Twitch reward saved" })
    .waitFor();
  assert.deepEqual(
    f.writes.map((row) => row.operation),
    ["create", "update"],
  );
  assert.equal(
    f.automations.status().rows.find((row) => row.name === "Unconfirmed fixture").trigger.rewardId,
    bound,
  );
});

test("quote list edits and deletes saved quotes through the sandboxed UI", async (t) => {
  const f = await setup(t, false, true),
    { panel } = f;
  f.automations.communityImport({
    quotes: [{ text: "First fixture", category: "Music" }, { text: "Second fixture" }],
  });
  await panel.locator("#quoteRefresh").click();
  await panel.locator("#quoteCount").filter({ hasText: "2 quotes" }).waitFor();
  assert.equal(await panel.locator("#source").isVisible(), false);
  await panel
    .locator(".quoteRow")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await panel.locator("#quoteText").fill("Edited fixture");
  await panel.locator("#quoteSave").click();
  await panel.locator("#quoteListStatus").filter({ hasText: "Quote saved." }).waitFor();
  assert.match(await panel.locator(".quoteRow").first().textContent(), /Edited fixture/);
  await panel
    .locator(".quoteRow")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await panel.locator("#quoteDeleteConfirm").click();
  await panel.locator("#quoteListStatus").filter({ hasText: "Numbers updated." }).waitFor();
  assert.equal(await panel.locator(".quoteRow strong").first().textContent(), "#1");
  assert.match(await panel.locator(".quoteRow").first().textContent(), /Second fixture/);
  await panel.locator("#quoteNew").click();
  await panel.locator("#quoteText").fill("New quote");
  await panel.locator("#quoteSave").click();
  await panel.locator("#quoteCount").filter({ hasText: "2 quotes" }).waitFor();
  await panel.locator("#quoteSearch").fill("New quote");
  await panel.locator("#quoteCount").filter({ hasText: "1 of 2" }).waitFor();
  assert.equal(await panel.locator(".quoteRow strong").first().textContent(), "#2");
  assert.equal(f.calls.length, 0);
});
test("automation list searches and filters compact rows, expands inline, and preserves focused drafts across polling", async (t) => {
  const f = await setup(t),
    { panel } = f;
  for (let i = 0; i < 25; i++) {
    const row = require("./support/twitch-automation-fixture.cjs").flow(
      (100 + i).toString(16).padStart(24, "0"),
      { type: "command", command: "!demo" + i },
    );
    row.name = "Demo " + i;
    row.steps = [{ actionId: "twitch.action.chat", params: { message: "Example reply " + i } }];
    await f.automations.save({ revision: f.automations.status().revision, automation: row });
  }
  for (const name of ["Timer 10", "Timer 2"]) {
    const row = require("./support/twitch-automation-fixture.cjs").flow(
      (500 + (name === "Timer 2" ? 2 : 10)).toString(16).padStart(24, "0"),
      { type: "timer", intervalMs: 60000, repeatLimit: 0, onlyLive: false, minMessages: 0 },
    );
    row.name = name;
    await f.automations.save({ revision: f.automations.status().revision, automation: row });
  }
  await panel.locator("#refresh").click();
  await panel.locator("#notice").filter({ hasText: "Ready." }).waitFor();
  await panel.locator('[data-automation-category="command"]').click();
  assert.equal(await panel.locator(".automationRowTitle").count(), 25);
  assert.deepEqual(
    (await panel.locator(".automationRowTitle strong").allTextContents()).slice(0, 3),
    ["!demo0", "!demo1", "!demo2"],
  );
  await panel.getByRole("button", { name: "Channel Points", exact: true }).click();
  assert.equal(await panel.locator(".automationRowTitle").count(), 1);
  await panel.getByRole("button", { name: "Timers & events", exact: true }).click();
  assert.deepEqual(await panel.locator(".automationRowTitle strong").allTextContents(), [
    "Timer 2",
    "Timer 10",
  ]);
  assert.equal(await panel.getByRole("button", { name: "All", exact: true }).count(), 0);
  await panel.getByRole("button", { name: "Chat commands", exact: true }).click();
  assert.equal(await panel.locator(".automationGroupHeading").count(), 1);
  await panel.locator("#automationSearch").fill("!demo7");
  assert.equal(await panel.locator(".automationRowTitle").count(), 1);
  await panel.locator("#automationFilter").selectOption("timer");
  assert.equal(await panel.locator(".automationRowTitle").count(), 0);
  await panel.getByRole("button", { name: "Chat commands", exact: true }).click();
  await panel.locator("#automationSearch").fill("!demo7");
  await panel.locator(".automationRowTitle").click();
  assert.equal(await panel.locator(".automationItem #editor").count(), 1);
  await panel.locator("#name").fill("Unsaved draft");
  await panel.locator("#name").focus();
  await f.page.waitForTimeout(2300);
  assert.equal(await panel.locator("#name").inputValue(), "Unsaved draft");
  assert.equal(
    await panel.locator("#name").evaluate((node) => node === document.activeElement),
    true,
  );
  if (process.env.GROBYS_DECK_CAPTURE_AUTOMATIONS === "1")
    await f.page.screenshot({
      path: path.join(__dirname, "../runtime/automation-list-private.png"),
      fullPage: true,
    });
  for (const width of [320, 390, 780, 1200]) {
    await f.page.setViewportSize({ width, height: 900 });
    const overflow = await panel.locator("body").evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const root = document.documentElement;
      if (root.scrollWidth <= innerWidth) return [];
      const overflowing = [...document.querySelectorAll("body *")]
        .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 12)
        .map((node) => node.id || node.className || node.nodeName);
      return [`${root.scrollWidth}px of content in ${innerWidth}px`, ...overflowing];
    });
    assert.deepEqual(overflow, [], "fits width " + width);
    assert.equal(
      await panel.locator(".commandCodeHighlight").evaluate((highlight) => {
        const width = highlight.style.width;
        highlight.style.width = "2000px";
        try {
          return highlight.offsetWidth <= highlight.parentElement.clientWidth;
        } finally {
          highlight.style.width = width;
        }
      }),
      true,
      "the highlight fits before ResizeObserver updates its measured width",
    );
  }
  assert.equal(f.calls.length, 0);
});
test("example commands load disabled drafts with roles and the fight recipe previews without creating records", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.getByText("Example commands & starter recipes", { exact: true }).click();
  await panel.locator("#commandExamples").selectOption("fight");
  await panel.locator("#useCommandExample").click();
  assert.equal(await panel.locator("#command").inputValue(), "!fight");
  assert.equal(await panel.locator("#enabled").count(), 0);
  assert.equal(await panel.locator("#role").inputValue(), "viewer");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const row = f.automations.status().rows.find((row) => row.trigger.command === "!fight");
  assert.equal(row.enabled, false);
  assert.equal(
    row.steps[0].params.message,
    require("../src/domains/twitch/command-arena-variables").message,
  );
  assert.equal(f.calls.length, 0);
  const preview = await f.automations.preview({
    template: row.steps[0].params.message,
    arguments: "sample_target",
  });
  assert.match(preview.text, /ROLLED:/);
  assert.equal(fs.existsSync(f.file.replace(".json", ".duels.json")), false);
});

test("the shared flow picker exposes canonical usernames and arbitrary saved fields without executing them", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.getByText("Example commands & starter recipes", { exact: true }).click();
  await panel.locator("#commandExamples").selectOption("fight");
  await panel.locator("#useCommandExample").click();
  const message = panel.locator('[data-deck-parameter="message"]');
  await message.fill("");
  await panel.getByText("Insert variable", { exact: true }).click();
  await panel.getByText("All variables and saved values", { exact: true }).click();
  await panel.getByLabel("Find a command variable", { exact: true }).fill("saved numeric");
  await panel
    .getByLabel("Command variable", { exact: true })
    .selectOption("${stat user rating 1000}");
  await panel.getByRole("button", { name: "Insert selected variable", exact: true }).click();
  assert.equal(await message.inputValue(), "${stat user rating 1000}");
  await panel.getByLabel("Find a command variable", { exact: true }).fill("username");
  await panel.getByLabel("Command variable", { exact: true }).selectOption("${username 1}");
  await panel.getByRole("button", { name: "Insert selected variable", exact: true }).click();
  assert.ok((await message.inputValue()).includes("${username 1}"));
  await f.page.setViewportSize({ width: 430, height: 932 });
  assert.ok(
    await panel
      .getByLabel("Command variable", { exact: true })
      .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
  );
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  assert.equal(f.calls.length, 0);
});

test("command names and exact phrases use compact removable pills and save pending input without changing access", async (t) => {
  const f = await setup(t),
    { panel } = f;
  const row = fixture.flow("c".repeat(24), {
    type: "command",
    command: "!pills",
    aliases: ["!hi", "!hello there"],
    keywords: ["how are you"],
  });
  row.role = "vip";
  row.cooldownSeconds = 37;
  row.userCooldownSeconds = 81;
  await f.automations.save({ revision: f.automations.status().revision, automation: row });
  await panel.locator("#refresh").click();
  await panel.locator('[data-automation-category="command"]').click();
  if (await panel.locator("#editor").isHidden())
    await panel.locator(".automationRowTitle").filter({ hasText: "!pills" }).click();
  await panel.locator("#commandExtras > summary").click();
  const extras = panel.locator("#commandExtras"),
    aliases = panel.locator("#commandAliases"),
    phrases = panel.locator("#commandKeywords");
  const beforeInput = f.automations.status().revision,
    attemptedSaves = [];
  f.page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/bridge") &&
      request.postDataJSON()?.method === "save"
    )
      attemptedSaves.push(request.url());
  });
  assert.equal(await extras.locator("textarea").count(), 0);
  assert.equal(await panel.locator("#aliasCount").textContent(), "2 names");
  await aliases.fill("HELLO");
  await aliases.press("Enter");
  assert.equal(await extras.getByRole("button", { name: "Remove !hello", exact: true }).count(), 1);
  await aliases.fill("!HELLO");
  await aliases.press("Enter");
  assert.equal(
    await extras.locator(".pillTokens li").count(),
    4,
    "duplicate names do not create another pill",
  );
  await aliases.press("Backspace");
  assert.equal(await extras.getByRole("button", { name: "Remove !hello", exact: true }).count(), 0);
  await phrases.fill("Hello, nice to see you");
  await phrases.press("Enter");
  assert.equal(
    await extras
      .getByRole("button", { name: "Remove hello, nice to see you", exact: true })
      .count(),
    1,
  );
  await phrases.press("Backslash");
  assert.equal(
    await extras
      .getByRole("button", { name: "Remove hello, nice to see you", exact: true })
      .count(),
    0,
  );
  await extras.getByRole("button", { name: "Remove !hi", exact: true }).click();
  await f.page.waitForTimeout(60);
  assert.deepEqual(
    attemptedSaves,
    [],
    "Enter creates pills without invoking the form Save shortcut",
  );
  assert.equal(f.automations.status().revision, beforeInput);
  await aliases.fill("pending");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const saved = f.automations.status().rows.find((item) => item.id === row.id);
  assert.deepEqual(saved.trigger.aliases, ["!hello there", "!pending"]);
  assert.deepEqual(saved.trigger.keywords, ["how are you"]);
  assert.equal(saved.role, "vip");
  assert.equal(saved.cooldownSeconds, 37);
  assert.equal(saved.userCooldownSeconds, 81);
  await panel
    .locator(".automationItem")
    .filter({ has: panel.locator(".automationRowTitle strong").filter({ hasText: "!pills" }) })
    .getByRole("switch", { name: "Pause automation", exact: true })
    .click();
  await panel.locator("#notice").filter({ hasText: "Automation paused." }).waitFor();
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  assert.equal(
    f.automations.status().rows.find((item) => item.id === row.id).enabled,
    false,
    "Save respects the list switch's latest state",
  );
  if (await panel.locator("#editor").isHidden())
    await panel.locator(".automationRowTitle").filter({ hasText: "!pills" }).click();
  if (!(await extras.evaluate((el) => el.open))) await extras.locator("summary").click();
  assert.equal(await extras.isVisible(), true);
  for (const width of [390, 1426]) {
    await f.page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await panel
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.ok(
      (await extras
        .locator(".pillInput")
        .first()
        .evaluate((el) => el.clientHeight)) < 160,
      "short lists stay compact",
    );
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});
test("a chat automation uses the shared builder, saves/reopens its restore flow, and fits a touch phone", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Temporary microphones");
  await panel.locator("#triggerType").selectOption("command");
  await panel.locator("#command").fill("!mics");
  await panel.locator("#role").selectOption("viewer");
  const root = panel.locator("#flow"),
    tools = root.locator(":scope > .deckSequenceTools");
  await tools.getByRole("button", { name: "+ Remember current values", exact: true }).click();
  if (!(await panel.locator(".library").evaluate((node) => node.open)))
    await panel.locator(".library > summary").click();
  await panel.locator("#actionChoice").selectOption("fixture.mic.one");
  await panel.locator("#addAction").click();
  await panel.locator("#actionChoice").selectOption("fixture.mic.two");
  await panel.locator("#addAction").click();
  await tools.getByRole("button", { name: "+ Add wait", exact: true }).click();
  await root.getByRole("spinbutton", { name: "Wait for", exact: true }).fill(".04");
  await tools.getByRole("button", { name: "+ Restore previous values", exact: true }).click();
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const saved = f.automations.status().rows.find((row) => row.trigger.command === "!mics");
  assert.deepEqual(
    saved.steps.map((step) => step.type || step.actionId),
    ["remember", "fixture.mic.one", "fixture.mic.two", "deck.wait", "restore"],
  );
  assert.equal(f.writes.length, 0);
  await panel
    .locator("#automationList")
    .locator(".automationRowTitle")
    .filter({ hasText: "Temporary microphones" })
    .click();
  if (process.env.GROBYS_DECK_CAPTURE_AUTOMATIONS === "1")
    await f.page.screenshot({
      path: path.join(__dirname, "../runtime/twitch-automations-private.png"),
      fullPage: true,
    });
  assert.equal(await root.locator("[data-step-kind=remember]").count(), 1);
  assert.equal(await root.locator("[data-step-kind=restore]").count(), 1);
  await f.automations.chat({
    broadcaster_user_id: "123",
    chatter_user_id: "456",
    message_id: "chat-ui",
    message: { text: "!mics" },
    badges: [],
  });
  await until(() => f.automations.status().history.length === 1);
  assert.deepEqual(
    [...f.mics],
    [
      ["one", false],
      ["two", true],
    ],
  );
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel
      .locator("body")
      .evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    true,
  );
});
test("existing rewards expose editing and a separate confirmed Twitch deletion", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel
    .locator("#automationList")
    .locator(".automationRowTitle")
    .filter({ hasText: "Switch microphones" })
    .click();
  await panel.locator("#cost").fill("350");
  await panel.locator("#save").click();
  await panel
    .locator("#notice")
    .filter({ hasText: "Automation and Twitch reward saved." })
    .waitFor();
  assert.equal(f.writes[0].operation, "update");
  assert.equal(f.writes[0].cost, 350);
  await panel.locator("#remove").click();
  await panel.locator("#confirmProceed").click();
  await panel.locator("#notice").filter({ hasText: "Automation removed." }).waitFor();
  assert.equal(f.rewards.length, 1);
  assert.equal(f.writes.filter((row) => row.operation === "delete").length, 0);
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("New reward");
  await panel.locator("#handler").selectOption("lights");
  await panel.locator("#rewardTitle").fill("My lights");
  await panel.locator("#save").click();
  await panel
    .locator("#notice")
    .filter({ hasText: "Twitch reward created and connected." })
    .waitFor();
  await panel.locator("#deleteReward").click();
  assert.equal(f.writes.filter((row) => row.operation === "delete").length, 0);
  await panel.locator("#confirmCancel").click();
  assert.equal(f.writes.filter((row) => row.operation === "delete").length, 0);
  await panel.locator("#deleteReward").click();
  await panel.locator("#confirmProceed").click();
  await panel.locator("#notice").filter({ hasText: "Reward deleted on Twitch." }).waitFor();
  assert.equal(f.writes.filter((row) => row.operation === "delete").length, 1);
});

test("row removal confirms beside the current view without opening or replacing an editor; Cancel keeps the command", async (t) => {
  const f = await setup(t),
    { panel } = f;
  const row = fixture.flow("d".repeat(24), { type: "command", command: "!removeexample" });
  await f.automations.save({ revision: f.automations.status().revision, automation: row });
  await panel.locator("#refresh").click();
  const item = panel.locator(".automationItem").filter({
    has: panel.locator(".automationRowTitle strong").filter({ hasText: "!removeexample" }),
  });
  await panel.locator('[data-automation-category="command"]').click();
  const revision = f.automations.status().revision;
  assert.equal(await panel.locator("#editor").isHidden(), true);
  await item.locator(".automationRemove").click();
  await panel.locator("#confirm[open]").waitFor();
  assert.equal(await panel.locator("#editor").isHidden(), true);
  assert.match(await panel.locator("#confirmTitle").textContent(), /!removeexample/);
  assert.equal(f.automations.status().revision, revision);
  await panel.locator("#confirmCancel").click();
  assert.equal(f.automations.status().revision, revision);
  assert.equal(
    await item.locator(".automationRemove").evaluate((el) => el === document.activeElement),
    true,
  );
  await item.locator(".automationRemove").click();
  await panel.locator("#confirmProceed").click();
  await panel.locator("#notice").filter({ hasText: "Automation removed." }).waitFor();
  assert.equal(
    f.automations.status().rows.some((other) => other.id === row.id),
    false,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});

test("timer and subscriber starters expose normal controls, persist trigger options, and appear as deck controls", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.getByText("Example commands & starter recipes", { exact: true }).click();
  await panel.locator("#presetTimer").click();
  assert.equal(await panel.locator("#triggerType").inputValue(), "timer");
  await panel.locator("#timerInterval").fill("15");
  await panel.locator("#timerCount").fill("3");
  await panel.locator("#timerMessages").fill("8");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const timer = f.automations.status().rows.find((row) => row.trigger.type === "timer");
  await panel
    .locator(".automationItem")
    .filter({ has: panel.getByRole("switch", { name: "Start automation", exact: true }) })
    .getByRole("switch", { name: "Start automation", exact: true })
    .first()
    .click();
  await panel.locator("#notice").filter({ hasText: "Automation started." }).waitFor();
  assert.equal(timer.trigger.intervalMs, 900000);
  assert.equal(timer.trigger.repeatLimit, 3);
  assert.equal(timer.trigger.minMessages, 8);
  assert.equal(timer.trigger.onlyLive, true);
  assert.equal(timer.steps[0].actionId, "twitch.action.chat");
  assert.ok(
    f.deck.catalog().actions.some((row) => row.id === "twitch.automation.toggle:" + timer.id),
  );
  await panel
    .locator("#automationList .automationItem")
    .filter({ hasText: "Chat reminder" })
    .getByRole("switch", { name: "Pause automation", exact: true })
    .last()
    .click();
  await panel.locator("#notice").filter({ hasText: "Automation paused." }).waitFor();
  assert.equal(f.automations.status().rows.find((row) => row.id === timer.id).enabled, false);
  await panel.locator("#presetSub").click();
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  assert.ok(f.automations.status().rows.some((row) => row.trigger.event === "channel.subscribe"));
  await panel
    .locator(".automationItem")
    .filter({ hasText: "Subscriber thank-you" })
    .getByRole("switch", { name: "Start automation", exact: true })
    .click();
  await panel.locator("#notice").filter({ hasText: "Automation started." }).waitFor();
  f.automations.setActive(true);
  await f.automations.event(
    "channel.subscribe",
    { broadcaster_user_id: "123", user_login: "viewer_name" },
    { message_id: "sub-ui" },
  );
  await until(() => f.calls.some((call) => call.twitch));
  assert.equal(
    f.calls.find((call) => call.twitch).twitch.params.message,
    "Thank you, viewer_name, for subscribing! Welcome to the community.",
  );
  assert.equal(f.writes.length, 0);
});

test("season starter exposes calendar units and UTC date, saves disabled and reopens without scheduling drift", async (t) => {
  const f = await setup(t),
    { panel } = f;
  await panel.getByText("Example commands & starter recipes", { exact: true }).click();
  await panel.locator("#commandExamples").selectOption("xp-seasons");
  await panel.locator("#useCommandExample").click();
  assert.equal(await panel.locator("#timerSchedule").inputValue(), "calendar");
  assert.equal(await panel.locator("#calendarMonths").inputValue(), "2");
  assert.equal(await panel.locator("#timerIntervalField").isVisible(), false);
  await panel.locator("#calendarNext").fill("2028-01-31T12:00");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  const row = f.automations
    .status()
    .rows.find((item) => item.name === "XP season: every two months");
  assert.equal(row.enabled, false);
  assert.equal(row.trigger.nextAt, Date.UTC(2028, 0, 31, 12));
  assert.equal(row.trigger.calendarDay, 31);
  assert.equal(row.steps[0].actionId, "twitch.action.recipe");
  await panel
    .locator("#automationList .automationItem")
    .filter({ hasText: row.name })
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await panel
    .locator("#automationList .automationItem")
    .filter({ hasText: row.name })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  assert.equal(await panel.locator("#calendarNext").inputValue(), "2028-01-31T12:00");
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  assert.equal(
    f.automations.status().rows.find((item) => item.id === row.id).trigger.calendarDay,
    31,
  );
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  assert.equal(f.calls.length, 0);
});

test("native raid preset hides fixed IDs and resolves each actual raider at execution time", async (t) => {
  const f = await setup(t),
    { panel } = f,
    status = f.provider.status;
  f.provider.status = () => ({
    ...status(),
    scopes: [...status().scopes, "moderator:manage:shoutouts"],
  });
  await panel.getByText("Example commands & starter recipes", { exact: true }).click();
  await panel.locator("#presetRaid").click();
  assert.equal(await panel.locator("#triggerType").inputValue(), "event");
  assert.equal(await panel.locator("#eventType").inputValue(), "channel.raid");
  assert.equal(await panel.locator("#automationFilter").inputValue(), "automation");
  assert.match(await panel.locator(".deckFlowTrigger").textContent(), /Incoming raid/);
  assert.equal(await panel.locator('[data-deck-parameter="userId"]').isVisible(), false);
  assert.equal(await panel.locator('[data-deck-parameter="userId"]').isDisabled(), true);
  assert.equal(await panel.locator("#enabled").count(), 0);
  await panel.locator('[data-deck-parameter="userId"]').evaluate((input) => {
    input.value = "111";
  });
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
  assert.equal(f.calls.length, 0);
  const saved = f.automations.status().rows.find((row) => row.trigger.event === "channel.raid");
  await panel
    .locator(".automationItem")
    .filter({ has: panel.getByRole("switch", { name: "Start automation", exact: true }) })
    .getByRole("switch", { name: "Start automation", exact: true })
    .first()
    .click();
  await panel.locator("#notice").filter({ hasText: "Automation started." }).waitFor();
  assert.deepEqual(saved.steps[0].params, { target: "raider" });
  f.automations.setActive(true);
  for (const [id, name] of [
    ["456", "first_raider"],
    ["789", "next_raider"],
  ]) {
    const completed = f.automations.status().history.length + 1;
    await f.automations.event(
      "channel.raid",
      {
        to_broadcaster_user_id: "123",
        from_broadcaster_user_id: id,
        from_broadcaster_user_login: name,
        viewers: 25,
      },
      { message_id: "raid-native-" + id },
    );
    if (id === "789") {
      await until(() => f.automations.status().history.length >= completed);
      f.advanceQueue(120251);
      await f.twitchActions.shoutouts.tick();
    }
    await until(() => f.calls.some((call) => call.twitch?.params.userId === id));
    await until(() => !f.twitchActions.shoutouts.snapshot().sending);
    await until(() => f.automations.status().history.length >= completed);
  }
  assert.deepEqual(
    f.calls.map((call) => call.twitch.params.userId),
    ["456", "789"],
  );
  assert.ok(f.calls.every((call) => call.twitch.kind === "shoutout"));
  assert.equal(f.writes.length, 0);
  await panel.locator("#eventType").selectOption("channel.subscribe");
  await panel.locator("#save").click();
  await panel
    .locator("#editorNotice")
    .filter({ hasText: "Incoming raider is supplied by an Incoming raid trigger" })
    .waitFor();
  assert.equal(
    f.automations.status().rows.find((row) => row.id === saved.id).trigger.event,
    "channel.raid",
  );
});

test("optional shoutout fields follow the target choice and validate only the selected mode", async (t) => {
  const { panel } = await setup(t);
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Recipient fixture");
  await panel.locator("#triggerType").selectOption("event");
  await panel.locator("#eventType").selectOption("channel.raid");
  await panel.locator("#actionChoice").selectOption("twitch.action.bot-shoutout");
  await panel.locator("#addAction").click();
  assert.equal(await panel.locator('[data-deck-parameter="login"]').isVisible(), false);
  await panel.locator('[data-deck-parameter="target"]').selectOption("login");
  assert.equal(await panel.locator('[data-deck-parameter="login"]').isVisible(), true);
  assert.equal(
    await panel.locator('[data-deck-parameter="login"]').evaluate((input) => input.required),
    true,
  );
  await panel.locator('[data-deck-parameter="target"]').selectOption("raider");
  assert.equal(await panel.locator('[data-deck-parameter="login"]').isVisible(), false);
  await panel.locator("#save").click();
  await panel.locator("#notice").filter({ hasText: "Automation saved." }).waitFor();
});

test("arena recipe exposes editable steps and previews changes without sending chat or saving records", async (t) => {
  const f = await setup(t, true),
    { panel } = f;
  await panel.locator("#examplesTab").click();
  assert.equal(await panel.locator("#arenaSteps textarea").count(), 15);
  await panel.locator("#arenaSteps > details > summary").nth(3).click();
  const rules = panel.locator("#arenaSteps textarea").nth(3);
  await rules.fill(
    (await rules.inputValue()).replace("${set difficulty 16}", "${set difficulty 12}"),
  );
  await panel.locator("#arenaSteps > details > summary").nth(5).click();
  const awards = panel.locator("#arenaSteps textarea").nth(5);
  await awards.fill(
    (await awards.inputValue())
      .replace("set xpAward 10 + (100 - winnerChance) * 2 / 5 + margin", "set xpAward 42")
      .replace("add xpAward 5", "add xpAward 0"),
  );
  await panel.locator("#tryArena").click();
  assert.ok((await panel.locator("#template").inputValue()).includes("${set difficulty 12}"));
  await panel.locator("#preview").click();
  await panel.locator("#result").filter({ hasText: "NEED: 12+" }).waitFor();
  assert.match(await panel.locator("#result").innerText(), /wins \(\+42 XP\)/);
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  assert.equal(f.calls.length, 0);
});

test("message ingredients insert only canonical dice, chance and counter functions", async (t) => {
  const { panel } = await setup(t, true);
  await panel.locator("#examplesTab").click();
  await panel.locator("#template").fill("");
  await panel.locator("#ingredient").selectOption("dice");
  await panel.locator("#ingredientFields input").fill("6");
  await panel.locator("#insertIngredient").click();
  assert.equal(await panel.locator("#template").inputValue(), "${random 1 6}");
  await panel.locator("#template").fill("");
  await panel.locator("#ingredient").selectOption("chance");
  await panel.locator("#ingredientFields input").nth(0).fill("60");
  await panel.locator("#ingredientFields input").nth(1).fill("Lucky!");
  await panel.locator("#ingredientFields input").nth(2).fill("Next time");
  await panel.locator("#insertIngredient").click();
  assert.equal(await panel.locator("#template").inputValue(), '${chance 60 "Lucky!" "Next time"}');
  await panel.locator("#template").fill("");
  await panel.locator("#ingredient").selectOption("counter");
  await panel.locator("#ingredientFields input").fill("victories");
  await panel.locator("#ingredientFields select").selectOption("read");
  await panel.locator("#insertIngredient").click();
  assert.equal(await panel.locator("#template").inputValue(), "${readcountvictories}");
});

test("event intake lives with automations and changing category closes the previous editor", async (t) => {
  const f = await setup(t),
    { panel } = f;
  assert.equal(await panel.locator("#automationIntake").count(), 0);
  await panel.locator(".automationRowTitle").first().click();
  assert.equal(await panel.locator("#editor").isVisible(), true);
  await panel.locator('[data-automation-category="command"]').click();
  assert.equal(await panel.locator("#editor").isVisible(), false);
  await panel.locator('[data-automation-category="reward"]').click();
  await panel.locator(".automationResponse").first().click();
  assert.equal(await panel.locator("#editor").isVisible(), true);
  for (const button of await panel.locator(".automationManage button").all()) {
    const fits = await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    assert.ok(fits);
  }
  assert.doesNotMatch(await panel.locator("#editor").innerText(), /\u00c3|\u00c2/);
  const shape = await panel
    .locator(".automationEnable")
    .first()
    .evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      trackRadius: parseFloat(getComputedStyle(node, "::before").borderRadius),
      thumbRadius: getComputedStyle(node.querySelector("span")).borderRadius,
    }));
  assert.ok(shape.height >= 44);
  assert.ok(shape.trackRadius >= 20);
  assert.equal(shape.thumbRadius, "50%");
});

test("command list creator selects, describes and splits public lists without changing automations", async (t) => {
  const f = await setup(t, "command-list", false, ""),
    { panel, page } = f;
  for (let i = 0; i < 25; i++) {
    const state = f.automations.status();
    await f.automations.save({
      revision: state.revision,
      automation: {
        name: "Command " + i,
        id: i.toString(16).padStart(24, "0"),
        enabled: true,
        role: "viewer",
        handler: "flow",
        trigger: {
          type: "command",
          command: "!guide" + i,
          ...(i === 0 ? { keywords: ["hello there"] } : {}),
        },
        steps:
          i === 0
            ? [
                {
                  actionId: "twitch.action.chat",
                  params: { message: "Hello ${sender}! Visits: ${countvisits}" },
                },
              ]
            : [{ actionId: "fixture.mic.one", params: { muted: true } }],
      },
    });
  }
  await panel.locator("#commandListRefresh").click();
  await panel.locator(".commandListChoice").filter({ hasText: "!guide24" }).waitFor();
  const before = JSON.stringify(f.automations.status().rows);
  assert.match(await panel.locator("#commandListCount").textContent(), /^0 \/ /);
  await panel.locator("#commandListSelect").click();
  assert.ok((await panel.locator(".commandListPart").count()) >= 1);
  await panel.locator("#commandListSearch").fill("!guide1");
  await panel
    .locator(".commandListChoice textarea")
    .first()
    .fill("A public description " + "x".repeat(700));
  await panel.locator("#commandListGenerate").click();
  assert.match(
    await panel.locator(".commandListPart textarea").first().inputValue(),
    /public description/,
  );
  await panel.locator("#commandListSearch").fill("!guide0");
  await panel.locator("#commandListPhrases").check();
  assert.match(
    (
      await panel
        .locator(".commandListPart textarea")
        .evaluateAll((nodes) => nodes.map((node) => node.value))
    ).join(""),
    /hello there/,
  );
  await panel.locator("#commandListExamples").check();
  let exampleText = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    exampleText = (
      await panel
        .locator(".commandListPart textarea")
        .evaluateAll((nodes) => nodes.map((node) => node.value))
    ).join("");
    if (exampleText.includes("Example reply: Hello")) break;
    await page.waitForTimeout(50);
  }
  assert.match(exampleText.replaceAll("\\", ""), /Hello sample_viewer!/);
  await panel.locator("#commandListStyle").selectOption("boxed");
  const copiedCommands = await panel
    .locator(".commandListPreview pre")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  assert.ok(copiedCommands.includes("!guide0"));
  assert.ok(copiedCommands.includes("!guide24"));
  assert.ok(copiedCommands.every((text) => /^![^\n]+$/.test(text)));
  assert.ok(
    copiedCommands.every((text) => !/Example reply:|Cooldown|public description/.test(text)),
  );
  const outsideBoxes = await panel
    .locator(".commandListPreview > p")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent).join("\n"));
  assert.match(outsideBoxes, /Hello sample_viewer!/);
  assert.match(outsideBoxes, /A public description/);
  assert.match(outsideBoxes, /hello there/);
  for (const part of await panel
    .locator(".commandListPart textarea")
    .evaluateAll((nodes) => nodes.map((node) => node.value))) {
    assert.ok(part.length <= 2000);
  }
  await panel.locator("#commandListExamples").uncheck();
  assert.doesNotMatch(
    (
      await panel
        .locator(".commandListPart textarea")
        .evaluateAll((nodes) => nodes.map((node) => node.value))
    ).join(""),
    /Example reply/,
  );
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  await panel.locator("#commandListFormat").selectOption("twitch");
  assert.equal(await panel.locator("#discordLimitField").isVisible(), false);
  assert.equal(await panel.locator("#twitchLimitField").isVisible(), true);
  await panel.locator("#commandListClear").click();
  assert.equal(await panel.locator(".commandListPart").count(), 0);
  assert.equal(JSON.stringify(f.automations.status().rows), before);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await panel.locator("#commandListWorkspace").evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  assert.equal(
    await panel.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
});

test("watchtime settings persist the streamer-selected mode without changing it after a raid", async (t) => {
  const f = await setup(t, "watchtime"),
    { panel } = f;
  assert.equal(await panel.locator("#mode").inputValue(), "followers");
  await panel.locator("#mode").selectOption("subscribed-followers");
  await panel.locator("#storageCap").selectOption("17179869184");
  await panel.locator("#save").click();
  await panel.locator("#status").filter({ hasText: "Settings saved" }).waitFor();
  assert.equal(f.automations.communityTracking({}).mode, "subscribed-followers");
  assert.equal(f.automations.communityTracking({}).storage.limitBytes, 17179869184);
  assert.match(await panel.locator("#storageUsage").textContent(), /MiB used/);
  await f.automations.event(
    "channel.raid",
    { to_broadcaster_user_id: "123", from_broadcaster_user_id: "456", viewers: 100000 },
    { message_id: "fixture-big-raid" },
  );
  assert.equal(f.automations.communityTracking({}).mode, "subscribed-followers");
});

test("sound-file actions in the opaque automation editor reuse saved files and multiple admitted outputs", async (t) => {
  const f = await setup(t),
    { panel } = f;
  const soundboard = require("../src/domains/control-deck/soundboard.service")({
    rootDir: path.resolve(__dirname, ".."),
    runtimeDir: f.runtimeDir,
    platform: "win32",
    request: async () => ({
      available: true,
      outputs: [
        { key: "device:" + "a".repeat(64), name: "Headphones" },
        { key: "device:" + "b".repeat(64), name: "Virtual cable" },
      ],
      playing: [],
    }),
  });
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF");
  bytes.write("WAVE", 8);
  const clip = await soundboard.library.upload(
    require("node:stream").Readable.from([bytes]),
    "Alert",
  );
  await soundboard.refresh(true);
  const original = f.automations.catalog;
  f.automations.catalog = () => {
    const value = original();
    return { ...value, actions: [...value.actions, ...soundboard.catalog()] };
  };
  await panel.locator("#refresh").click();
  await panel.locator("#newAutomation").click();
  await panel.locator("#name").fill("Audio alert");
  await panel.locator("#actionChoice").selectOption("native.soundboard.play");
  await panel.locator("#addAction").click();
  await panel.locator('[data-deck-parameter="clip"]').selectOption(clip.id);
  const outputs = panel.locator(".deckSoundOutputs");
  await outputs.getByLabel("Headphones", { exact: true }).check();
  await outputs.getByLabel("Virtual cable", { exact: true }).check();
  await outputs.getByLabel("Windows default output", { exact: true }).uncheck();
  assert.deepEqual(
    JSON.parse(await panel.locator('[data-deck-parameter="outputs"]').inputValue()),
    ["device:" + "a".repeat(64), "device:" + "b".repeat(64)],
  );
  assert.equal(await panel.locator("input[type=file]").count(), 0);
  assert.equal(await panel.locator('[data-deck-parameter="volume"]').isVisible(), false);
  assert.ok((await panel.locator("#editor").textContent()).includes("Choose a saved audio file"));
});
