const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const source = require("../src/domains/twitch/command-source"),
  { render } = require("../src/domains/twitch/command-template"),
  fixture = require("./support/twitch-automation-fixture.cjs");

function counters() {
  const values = new Map([
    ["adddeath", 8],
    ["death total", 12],
  ]);
  const writes = [];
  const counter = (key, mode, amount) => {
    if (mode !== "get") {
      writes.push([key, mode, amount]);
      values.set(key, mode === "set" ? amount : (values.get(key) || 0) + amount);
    }
    return values.get(key) || 0;
  };
  return { counter, writes, values };
}
test("all counter operations migrate to readable calls using the same persisted names and totals", async () => {
  const cases = [
    ["${count[adddeath]}", "${countadddeath}", "9", 9],
    ["${count death total}", "${countdeath total}", "13", 13, "death total"],
    ["${getcount[adddeath]}", "${readcountadddeath}", "8", 8],
    ["${setcount[adddeath|0]}", "${resetcountadddeath}", "0", 0],
    ["${setcount[adddeath|10]}", "${setcount adddeath 10}", "10", 10],
    ["${addcount[adddeath|-1]}", "${addcount adddeath -1}", "7", 7],
    ["${addcount[death total|2]}", '${addcount "death total" 2}', "14", 14, "death total"],
    [
      "${addcount[adddeath|-1]} / ${addcount[adddeath|-1]}",
      "${addcount adddeath -1} / ${addcount adddeath -1}",
      "7 / 6",
      6,
    ],
  ];
  for (const [old, modern, expectedReply, expectedTotal, name = "adddeath"] of cases) {
    const migrated = source.canonical(old);
    assert.equal(migrated, modern);
    assert.equal(source.canonical(modern), modern);
    const store = counters();
    assert.equal(await render(migrated, store), expectedReply);
    assert.equal(store.values.get(name), expectedTotal);
  }
});
test("nested choices and conditions retain lazy side effects; templates never evaluate inserted viewer text", async () => {
  const old =
      "${set[roll|${random[1|20]}]}${if[${calc[${get[roll]}>=16]}|${pick[Win ${addcount[adddeath|-1]}|Hooray ${get[roll]}]}|Lost ${setcount[adddeath|0]}]} ${args[2]}",
    modern = source.canonical(old);
  assert.doesNotMatch(modern, /\$\{[a-z]+\[/i);
  const scenarios = [
    [0, "Lost 0", [["adddeath", "set", 0]]],
    [0.25, "Lost 0", [["adddeath", "set", 0]]],
    [0.99, "Hooray 20", []],
  ];
  for (const [draw, reply, writes] of scenarios) {
    const store = counters();
    const context = { argv: ["friend", "${countinjected}"] };
    assert.equal(
      await render(modern, { ...store, context, random: () => draw }),
      reply + " ${countinjected}",
    );
    assert.deepEqual(store.writes, writes);
    assert.equal(store.values.has("injected"), false);
  }
  assert.equal(
    source.canonical("Literal \\${addcount[adddeath|-1]}"),
    "Literal \\${addcount[adddeath|-1]}",
  );
  assert.throws(() => source.canonical("${eval[process.exit()] }"), /old eval/);
});
test("saved templates and chat-managed replies use canonical authoring text while existing packed recipes decode", async (t) => {
  const f = fixture(t),
    row = fixture.flow("a".repeat(24), { type: "command", command: "!example" });
  row.steps = [
    { actionId: "twitch.action.chat", params: { message: "${addcount[adddeath|-1]} deaths" } },
  ];
  await f.automations.save({ revision: f.automations.status().revision, automation: row });
  assert.equal(
    f.automations.status().rows.find((other) => other.id === row.id).steps[0].params.message,
    "${addcount adddeath -1} deaths",
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
  const original = "${set roll random 1 20}Roll: ${roll}",
    packed =
      "${set[recipe_source|" +
      require("node:zlib").deflateRawSync(original).toString("base64") +
      "]}" +
      source.compile(original);
  assert.equal(source.canonical(packed), "${set roll random 1 20}Roll: ${roll}");
  assert.throws(() => source.canonical(packed + "tampered"), /recipe_source/);
});

test("a current host receives readable source directly, without generating an older encoded recipe", async () => {
  const worker = require("../features/twitch-integration/dist/main"),
    calls = [];
  await worker.activate({
    callCapability: async (_capability, method, payload) => {
      calls.push({ method, payload });
      return method === "automation-catalog"
        ? { ok: true, supportsReadableCommandSource: true }
        : { ok: true, automation: payload.automation };
    },
  });
  try {
    const result = await worker.handleRequest({
      capability: "twitch.automations.v1",
      method: "save",
      payload: {
        automation: {
          steps: [
            { actionId: "twitch.action.chat", params: { message: "${addcount[adddeath|-1]}" } },
          ],
        },
      },
    });
    const saved = calls.find((call) => call.method === "automation-save").payload;
    assert.equal(saved.automation.steps[0].params.message, "${addcount adddeath -1}");
    assert.equal(result.automation.steps[0].params.message, "${addcount adddeath -1}");
  } finally {
    await worker.deactivate();
  }
});
test("startup migrates stored messages once, backs up locally and preserves settings and unrelated data", async (t) => {
  const f = fixture(t);
  f.automations.shutdown();
  const row = {
    ...fixture.flow("b".repeat(24), { type: "command", command: "!example", aliases: ["!alias"] }),
    accountId: "123",
    enabled: false,
    role: "vip",
    cooldownSeconds: 100,
    userCooldownSeconds: 200,
    steps: [
      {
        actionId: "twitch.action.chat",
        delayMs: 0,
        params: { message: "${addcount[adddeath|-1]} deaths" },
      },
    ],
  };
  const data = { version: 1, revision: 12, rows: [row], detached: [], receipts: [] };
  fs.mkdirSync(path.dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, JSON.stringify(data));
  const counterFile = f.file.replace(/\.json$/, ".counters.json");
  fs.writeFileSync(counterFile, "private test totals");
  const make = () => require("../src/domains/twitch/twitch-automations.service")(f.options);
  const first = make();
  const saved = JSON.parse(fs.readFileSync(f.file));
  assert.deepEqual(saved.rows[0], {
    ...row,
    steps: [
      {
        actionId: "twitch.action.chat",
        delayMs: 0,
        params: { message: "${addcount adddeath -1} deaths" },
      },
    ],
  });
  assert.equal(saved.revision, 13);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.file.replace(/\.json$/, ".syntax-backup.json"))),
    data,
  );
  assert.equal(fs.readFileSync(counterFile, "utf8"), "private test totals");
  first.shutdown();
  const second = make();
  assert.equal(second.status().revision, 13);
  second.shutdown();
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(fs.existsSync(path.dirname(f.file)), true);
});
