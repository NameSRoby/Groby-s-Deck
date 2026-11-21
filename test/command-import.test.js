const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { prepare, convert } = require("../src/domains/twitch/command-import"),
  triggers = require("../src/domains/twitch/command-triggers"),
  { render } = require("../src/domains/twitch/command-template");
const custom = (overrides = {}) => ({
  command: "example",
  accessLevel: 400,
  reply: "Hello ${user}",
  enabled: true,
  type: "say",
  cooldown: { global: 5, user: 15 },
  aliases: [],
  keywords: [],
  ...overrides,
});
test("custom imports preserve native roles, explicit legacy mappings, aliases, cooldowns and disabled commands", () => {
  const rows = prepare([
    custom({
      command: "3000days",
      enabled: false,
      aliases: ["other", "other", "hello there"],
      keywords: ["hello?"],
    }),
    custom({ command: "oldmod", accessLevel: 1000 }),
  ]);
  assert.equal(rows[0].automation.enabled, false);
  assert.equal(rows[0].automation.role, "vip");
  assert.deepEqual(rows[0].automation.trigger.aliases, ["!other", "!hello there"]);
  assert.equal(rows[1].automation.role, "broadcaster");
  assert.match(rows[1].notes[0], /legacy role/);
  for (const row of rows)
    require("../src/domains/twitch/twitch-automation-config").normalize(row.automation, "123");
});
test("legacy counters, nested choices and target metadata convert without executing code", async () => {
  assert.equal(
    convert("${count score 0} ${count score -1} $(count)", "example"),
    "${resetcountscore} ${addcount score -1} ${countexample}",
  );
  const source = convert("${random.pick 'low ${random.1-5}' 'high ${random.6-10}'}", "example");
  assert.equal(await render(source, { random: () => 0 }), "low 1");
  assert.equal(convert("${game ${1}} ${channel ${1}}", "example"), "${game user} ${user}");
  assert.throws(() => convert("${eval process.exit()}", "example"), /unsupported/);
});
test("aliases match longest whole command and exact phrases; share one row for roles and cooldowns", () => {
  const row = prepare([custom({ aliases: ["hello there", "hi?"], keywords: ["how are you"] })])[0]
    .automation;
  assert.deepEqual(triggers.match([row], "!hello there Friend").argv, ["Friend"]);
  assert.equal(triggers.match([row], "HOW ARE YOU").row.id, row.id);
  assert.equal(triggers.match([row], "I said how are you"), undefined);
  assert.equal(triggers.match([row], "!exampleextra"), undefined);
  assert.equal(triggers.match([row], "!hi?").row.id, row.id);
  assert.throws(
    () => triggers.normalize({ type: "command", command: "!example", aliases: ["!sr"] }),
    /reserved/,
  );
});
test("queued imports are account scoped, keep intervening edits and never execute actions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "commands.json"),
    pending = file.replace(".json", ".import.json"),
    { apply, fingerprint } = require("../src/domains/twitch/command-pending-import");
  const automation = prepare([custom()])[0].automation,
    normalize = require("../src/domains/twitch/twitch-automation-config").normalize,
    current = normalize(automation, "123");
  const plan = {
    version: 1,
    owner: "123",
    rows: [{ automation: { ...automation, name: "Improved" }, expected: fingerprint(current) }],
  };
  fs.writeFileSync(pending, JSON.stringify(plan));
  const data = { version: 1, revision: 5, rows: [current], receipts: [], detached: [] };
  const result = apply(file, data);
  assert.equal(result.data.rows[0].name, "Improved");
  assert.equal(result.data.revision, 6);
  assert.equal(
    apply(file, { ...data, rows: [{ ...current, name: "My later edit" }] }).data.rows[0].name,
    "My later edit",
  );
  result.finish();
  assert.equal(fs.existsSync(pending), false);
  assert.equal(apply(file, result.data).changed, false);
});
