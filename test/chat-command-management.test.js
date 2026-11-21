const test = require("node:test"),
  assert = require("node:assert/strict");
const fixture = require("./support/twitch-automation-fixture.cjs");
test("missing command targets produce a chat hint instead of a silent failed flow", async (t) => {
  const f = fixture(t),
    sent = [];
  f.provider.sendChat = async (value) => {
    sent.push(value.message);
    return { ok: true };
  };
  const row = fixture.flow("e".repeat(24), { type: "command", command: "!targettest" });
  row.steps = [{ actionId: "twitch.action.chat", params: { message: "${opponent}" } }];
  await f.automations.save({ revision: f.automations.status().revision, automation: row });
  await f.automations.chat({
    broadcaster_user_id: "123",
    chatter_user_id: "456",
    chatter_user_login: "viewer",
    message_id: "missing-target",
    message: { text: "!targettest" },
    badges: [],
  });
  await fixture.until(() => sent.length === 1);
  assert.match(sent[0], /!targettest name/);
  assert.equal(f.automations.status().history[0].code, "twitch_command_target_required");
});
test("moderator chat management persists ordinary commands, preserves access, validates syntax and protects flows", async (t) => {
  const f = fixture(t),
    sent = [];
  let now = 0,
    id = 0;
  f.automations.shutdown();
  f.provider.sendChat = async ({ message }) => {
    sent.push(message);
    return { ok: true };
  };
  const service = require("../src/domains/twitch/twitch-automations.service")({
    ...f.options,
    now: () => now,
  });
  t.after(() => service.shutdown());
  async function command(text, role = "moderator") {
    now += 6000;
    const before = sent.length;
    const event = {
      broadcaster_user_id: "123",
      chatter_user_id: role === "broadcaster" ? "123" : "4",
      chatter_user_login: "viewer",
      message_id: String(++id),
      badges: role === "moderator" ? [{ set_id: "moderator" }] : [],
      message: { text },
    };
    await service.chat(event);
    await fixture.until(() => sent.length > before);
    return sent.at(-1);
  }
  assert.match(await command("!command add hello Hello ${sender}!", "viewer"), /Only moderators/);
  assert.equal(service.status().rows.filter((row) => row.trigger.type === "command").length, 0);
  assert.match(await command("!command add hello Hello ${sender}!"), /!hello added/);
  let row = service.status().rows.find((row) => row.trigger.command === "!hello");
  assert.equal(row.steps[0].params.message, "Hello ${sender}!");
  assert.equal(row.trigger.onlyLive, false);
  assert.match(await command("!command add hello Wrong"), /already exists/);
  row.role = "vip";
  row.cooldownSeconds = 9;
  row.trigger.aliases = ["!hi"];
  await service.save({ revision: service.status().revision, automation: row });
  assert.match(
    await command("!command edit !hello ${set roll random.1-20}${sender} rolled ${roll}!"),
    /updated/,
  );
  row = service.status().rows.find((row) => row.trigger.command === "!hello");
  assert.equal(row.role, "vip");
  assert.equal(row.cooldownSeconds, 9);
  assert.deepEqual(row.trigger.aliases, ["!hi"]);
  const revision = service.status().revision;
  assert.match(await command("!command edit hello ${if 1 == 1}Missing end"), /end/);
  assert.equal(service.status().revision, revision);
  assert.match(await command("!command delete hello", "viewer"), /Only moderators/);
  row.role = "broadcaster";
  await service.save({ revision: service.status().revision, automation: row });
  assert.match(await command("!command delete hello"), /Only the broadcaster/);
  assert.match(await command("!command delete hello", "broadcaster"), /deleted/);
  assert.equal(
    service.status().rows.some((row) => row.trigger.command === "!hello"),
    false,
  );
  assert.match(await command("!command add title nope"), /built-in/);
  const flow = fixture.flow("f".repeat(24), { type: "command", command: "!studio" });
  await service.save({ revision: service.status().revision, automation: flow });
  assert.match(await command("!command edit studio Replacement"), /custom flow/);
  assert.equal(
    service.status().rows.find((row) => row.id === flow.id).steps.length,
    flow.steps.length,
  );
});
