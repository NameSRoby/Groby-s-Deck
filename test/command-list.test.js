const test = require("node:test"),
  assert = require("node:assert/strict");
const model = require("../features/twitch-integration/ui/command-list-model");
test("Discord command boxes exclude replies and metadata while packing within both message limits", () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({
    command: "!item" + i,
    description: "Useful description",
    example: "Hello @everyone ```",
    included: true,
    enabled: true,
    role: "Everyone",
  }));
  for (const limit of [2000, 4000]) {
    const result = model.generate(rows, {
      style: "boxed",
      format: "discord",
      limit,
      examples: true,
      access: true,
      title: "Commands",
    });
    assert.ok(result.parts.length > 1);
    for (const [i, part] of result.parts.entries()) {
      assert.ok(part.length <= limit);
      const boxes = [...part.matchAll(/```text\n([\s\S]*?)\n```/g)];
      assert.ok(boxes.length > 0);
      assert.equal(part.split("```").length, boxes.length * 2 + 1);
      for (const box of boxes) assert.match(box[1], /^!item\d+$/);
      assert.doesNotMatch(part, /@everyone/);
      if (i < result.parts.length - 1)
        assert.ok(part.length > limit - 200, "parts should use the available budget");
    }
    for (let i = 0; i < 80; i++)
      assert.equal(result.parts.join("\n").split("!item" + i + "\n").length, 2);
  }
});
test("a copied command keeps its usable arguments; all details remain outside its box even across parts", () => {
  const row = {
    command: "!fight",
    usage: "!fight @opponent",
    included: true,
    enabled: true,
    description: "Duel another player.",
    example: "Rolled 18. You win!",
    aliases: ["!duel"],
    phrases: ["fight me"],
    role: "Everyone",
    cooldown: 30,
    userCooldown: 60,
  };
  const options = {
    format: "discord",
    style: "boxed",
    examples: true,
    access: true,
    aliases: true,
    phrases: true,
    cooldowns: true,
  };
  const text = model.generate([row], options).parts.join("\n");
  const boxes = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)];
  assert.deepEqual(
    boxes.map((box) => box[1]),
    ["!fight @opponent"],
  );
  const outside = text.replace(/```text\n[\s\S]*?\n```/g, "");
  for (const detail of [
    "Duel another player.",
    "Example reply:",
    "Also:",
    "!duel",
    "Triggers:",
    "fight me",
    "Everyone",
    "Cooldown",
  ])
    assert.ok(outside.replaceAll("\\", "").includes(detail), detail);
  for (const limit of [2000, 4000]) {
    const result = model.generate(
      [{ ...row, description: "🙂".repeat(2400), example: "*".repeat(2000) }],
      { ...options, limit },
    );
    assert.ok(result.parts.length > 1);
    assert.ok(result.parts.every((part) => part.length <= limit));
    assert.equal(
      result.parts.join("\n").match(/```text\n/g).length,
      1,
      "the command is not split or repeated",
    );
    result.parts.forEach((part) => {
      assert.equal(part.split("```").length % 2, 1);
      assert.doesNotMatch(part, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u);
    });
  }
});
test("command lists exclude internal replies and unselected commands; annotate access without changing sources", () => {
  const source = [
    {
      id: "one",
      name: "Duel another player",
      enabled: true,
      role: "viewer",
      cooldownSeconds: 30,
      userCooldownSeconds: 60,
      trigger: { type: "command", command: "!fight", aliases: ["!duel"], keywords: ["fight me"] },
      steps: [{ params: { message: "PRIVATE_REPLY_TOKEN" } }],
    },
    { id: "reward", trigger: { type: "reward" } },
    { id: "two", name: "Hidden", trigger: { type: "command", command: "!hidden" } },
  ];
  const before = JSON.stringify(source),
    rows = model.commands(source);
  assert.equal(rows.length, 2);
  rows[0].included = true;
  const text = model
    .generate(rows, {
      title: "Commands",
      format: "discord",
      access: true,
      aliases: true,
      cooldowns: true,
      phrases: true,
    })
    .parts.join("");
  assert.match(text, /fight/);
  assert.match(text, /duel/);
  assert.match(text, /Everyone/);
  assert.match(text, /30s/);
  assert.match(text, /1m/);
  assert.doesNotMatch(text, /PRIVATE_REPLY_TOKEN|hidden/);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(model.generate(rows.map((row) => ({ ...row, included: false }))).parts, []);
});
test("Discord splitting counts headings and escapes; every entry occurs once with no broken formatting", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    command: "!entry" + i,
    usage: "!entry" + i,
    description: "A useful command " + "x".repeat(160),
    role: "Everyone",
    included: true,
    enabled: true,
  }));
  for (const limit of [2000, 4000]) {
    const result = model.generate(rows, { title: "Commands", format: "discord", limit });
    assert.ok(result.parts.length > 1);
    result.parts.forEach((part) => {
      assert.ok(part.length <= limit);
      assert.ok(part.startsWith("**Commands**"));
      assert.equal(part.split("**").length % 2, 1);
    });
    for (let i = 0; i < 120; i++)
      assert.equal(result.parts.join("\n").split("**!entry" + i + "**").length, 2);
  }
  rows[0].description = "@everyone <@123> **oops** <script>alert(1)</script>";
  const escaped = model.generate(rows.slice(0, 1), { format: "discord" }).parts[0];
  assert.doesNotMatch(escaped, /@everyone|<@123>/);
  assert.match(escaped, /\\\*\\\*oops/);
});
test("long descriptions, emoji and panel output remain bounded and use Markdown hard breaks", () => {
  const row = {
    command: "!long",
    usage: "!long " + "*".repeat(1000),
    description: "\\".repeat(5000) + "??".repeat(1000),
    included: true,
    enabled: true,
    role: "Everyone",
    aliases: [],
  };
  const result = model.generate([row], { title: "*".repeat(100), format: "twitch", limit: 1000 });
  assert.ok(result.parts[0].length <= 1000);
  assert.ok(result.parts.length > 1);
  result.parts.forEach((part) => assert.ok(part.length <= 1000));
  const parts = model.generate(
    [
      { ...row, usage: "!one", description: "First" },
      { ...row, usage: "!two", description: "Second" },
    ],
    { format: "twitch" },
  ).parts[0];
  assert.match(parts, / {2}\n\* /);
  assert.ok(model.builtins().every((entry) => !entry.included));
});

test("command list clipboard uses the active first-party host without reading clipboard data", async (t) => {
  const express = require("express"),
    fs = require("node:fs"),
    path = require("node:path"),
    { chromium } = require("playwright");
  const app = express();
  app.use(express.json());
  app.get("/child", (_req, res) =>
    res
      .type("html")
      .send(
        fs.readFileSync(
          path.join(__dirname, "../features/twitch-integration/ui/command-list.html"),
          "utf8",
        ),
      ),
  );
  app.post("/api/features/twitch-integration/call", (req, res) =>
    res.json({
      ok: true,
      value:
        req.body.method === "catalog"
          ? { ok: true, supportsCommunityCommands: false }
          : {
              ok: true,
              rows: [
                {
                  id: "hello",
                  name: "Say hello",
                  enabled: true,
                  role: "viewer",
                  trigger: { type: "command", command: "!hello" },
                },
              ],
            },
    }),
  );
  app.get("/", (req, res) =>
    res
      .type("html")
      .send(
        `<iframe id="surface" sandbox="allow-scripts" data-src="/child" style="width:100%;height:1000px;border:0"></iframe><script>window.ravelinkFeatureEvents={subscribe:()=>()=>{}};window.__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied.push(text)}});(${require("../src/capabilities/feature-platform/http/feature-ui-relay").toString()})(${JSON.stringify({ featureId: "twitch-integration", pageId: req.query.wrong ? "quotes" : "command-list", surface: "panel", capabilities: ["twitch.automations.v1"], pageIds: [] })});</script>`,
      ),
  );
  const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    }),
    browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }),
    base = "http://127.0.0.1:" + server.address().port;
  for (const wrong of [false, true]) {
    await page.goto(base + (wrong ? "/?wrong=1" : "/"));
    const panel = page.frameLocator("#surface");
    await panel.locator(".commandListChoice").first().waitFor();
    await panel.locator("body").evaluate(() => (document.execCommand = () => false));
    await panel.locator('input[aria-label="Include !hello"]').check();
    await panel.getByRole("button", { name: "Copy part 1", exact: true }).click();
    await panel
      .locator("#commandListStatus")
      .filter({ hasText: wrong ? "Automatic copy is unavailable" : "Copied." })
      .waitFor();
    const copies = await page.evaluate(() => window.__copied);
    assert.equal(copies.length, wrong ? 0 : 1);
    if (!wrong) assert.match(copies[0], /!hello/);
  }
});
