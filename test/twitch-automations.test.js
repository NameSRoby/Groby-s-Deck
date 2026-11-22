const savedCounters = require("./support/counter-snapshot.cjs");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const fixture = require("./support/twitch-automation-fixture.cjs"),
  { flow, until } = fixture;
const event = (rewardId = "reward-one") => ({
  id: "redemption-one",
  broadcaster_user_id: "123",
  reward: { id: rewardId },
  user_id: "viewer",
});

test("renamed mod actions upgrade saved Twitch flows without changing access, cooldowns or activation", async (t) => {
  const f = fixture(t);
  const { actionIds } = require("../src/shared/fs/upgrade-identifiers.json");
  const [[old, current]] = Object.entries(actionIds);
  const row = flow("c".repeat(24), { type: "command", command: "!cliptest" });
  row.enabled = false;
  row.role = "moderator";
  row.cooldownSeconds = 90;
  row.steps = [{ actionId: old, params: { duration: 30 } }];
  await f.automations.save({ revision: 0, automation: row });
  assert.equal(f.automations.status().rows[0].steps[0].actionId, current);
  f.automations.shutdown();
  const data = JSON.parse(fs.readFileSync(f.file));
  data.rows[0].steps[0].actionId = old;
  fs.writeFileSync(f.file, JSON.stringify(data));
  const reopened = require("../src/domains/twitch/twitch-automations.service")(f.options);
  t.after(() => reopened.shutdown());
  const saved = reopened.status().rows[0];
  assert.equal(saved.steps[0].actionId, current);
  assert.equal(saved.enabled, false);
  assert.equal(saved.role, "moderator");
  assert.equal(saved.cooldownSeconds, 90);
  assert.equal(saved.steps[0].params.duration, 30);
  assert.equal(fs.existsSync(f.file.replace(".json", ".syntax-backup.json")), true);
  assert.deepEqual(f.calls, []);
});
test("subscriber/broadcaster gates and user cooldowns apply before counters, and failed templates commit nothing", async (t) => {
  const f = fixture(t),
    row = flow("f".repeat(24), { type: "command", command: "!deaths" });
  row.role = "subscriber";
  row.cooldownSeconds = 0;
  row.userCooldownSeconds = 30;
  row.steps = [{ actionId: "twitch.action.chat", params: { message: "Deaths: ${countdeaths}" } }];
  await f.automations.save({ revision: 0, automation: row });
  const chat = {
    broadcaster_user_id: "123",
    chatter_user_id: "456",
    message_id: "denied",
    message: { text: "!deaths" },
    badges: [],
  };
  assert.equal((await f.automations.chat(chat)).code, "twitch_automation_role_required");
  assert.equal(fs.existsSync(f.file.replace(".json", ".counters.json")), false);
  chat.badges = [{ set_id: "founder" }];
  chat.message_id = "allowed";
  assert.equal((await f.automations.chat(chat)).accepted, true);
  await until(() => f.automations.status().running.length === 0);
  assert.equal(f.calls.find((call) => call.twitch).twitch.params.message, "Deaths: 1");
  chat.message_id = "cooldown";
  assert.equal((await f.automations.chat(chat)).code, "twitch_automation_user_cooldown");
  const preview = await f.automations.preview({ template: "${countdeaths}" });
  assert.equal(preview.text, "2");
  const counterFile = f.file.replace(".json", ".counters.json");
  assert.equal(JSON.parse(savedCounters(counterFile)).values["123:deaths"], 1);
  const bad = await f.automations.preview({ template: "${countdeaths} ${missing}" });
  assert.match(bad.validationError, /Unknown/);
  assert.equal(JSON.parse(savedCounters(counterFile)).values["123:deaths"], 1);
  row.role = "broadcaster";
  await f.automations.save({ revision: 1, automation: row });
  chat.badges = [{ set_id: "moderator" }];
  chat.message_id = "moderator-denied";
  assert.equal((await f.automations.chat(chat)).code, "twitch_automation_role_required");
});
test("legacy rewards are editable flows; one redemption switches two mics then restores original values", async (t) => {
  const f = fixture(t),
    existing = f.automations.status().rows[0],
    row = flow(existing.id);
  await f.automations.save({ revision: 0, automation: row });
  assert.equal(f.writes.length, 0, "saving a flow never edits or creates a Twitch reward");
  const response = await f.automations.redemption(event());
  assert.equal(response.body.settlement.pending, true);
  await until(() => f.mics.get("one") === true);
  assert.equal(f.mics.get("two"), false);
  await until(() => f.settlements.length === 1);
  assert.deepEqual(
    [...f.mics],
    [
      ["one", false],
      ["two", true],
    ],
  );
  assert.equal(f.settlements[0].status, "FULFILLED");
  assert.equal(f.automations.status().history[0].ok, true);
});
test("removing a built-in binding retains the actual reward and handler choices; later redemption is refunded", async (t) => {
  const f = fixture(t),
    row = f.automations.status().rows[0];
  await f.automations.remove({ id: row.id, revision: 0 });
  assert.equal(f.automations.status().rows.length, 0);
  assert.equal(f.rewards.length, 1);
  assert.equal(f.writes.length, 0);
  const result = await f.automations.redemption(event());
  assert.equal(result.handled, true);
  assert.equal(f.settlements[0].status, "CANCELED");
  assert.equal(f.calls.length, 0);
  const newRow = flow(row.id);
  newRow.handler = "song_request";
  newRow.steps = [];
  await f.automations.save({ revision: 1, automation: newRow });
  await f.automations.redemption(event());
  assert.equal(f.calls[0].legacy.song_request.rewardId, "reward-one");
});
test("chat triggers enforce roles, cooldown and durable duplicates and never interpolate viewer arguments", async (t) => {
  const f = fixture(t),
    row = flow("b".repeat(24), { type: "command", command: "!mics" });
  row.role = "vip";
  await f.automations.save({ revision: 0, automation: row });
  const chat = {
    broadcaster_user_id: "123",
    chatter_user_id: "viewer",
    message_id: "chat-1",
    message: { text: "!mics arbitrary secret-like arguments" },
    badges: [],
  };
  assert.equal((await f.automations.chat(chat)).code, "twitch_automation_role_required");
  chat.badges = [{ set_id: "vip" }];
  chat.message_id = "chat-2";
  assert.equal((await f.automations.chat(chat)).accepted, true);
  await until(() => f.automations.status().history.length === 1);
  assert.equal((await f.automations.chat(chat)).code, "duplicate");
  chat.message_id = "chat-3";
  assert.equal((await f.automations.chat(chat)).code, "twitch_automation_cooldown");
  const reopened = require("../src/domains/twitch/twitch-automations.service")(f.options);
  assert.equal((await reopened.chat({ ...chat, message_id: "chat-2" })).code, "duplicate");
  reopened.shutdown();
  assert.equal(JSON.stringify(f.calls).includes("arbitrary"), false);
  assert.equal(fs.readFileSync(f.file, "utf8").includes("secret-like"), false);
});
test("busy flows refund a second admission; Stop restores both mics and leaves interrupted redemption for review", async (t) => {
  const f = fixture(t),
    row = flow(f.automations.status().rows[0].id);
  row.steps[2].params.durationMs = 60000;
  await f.automations.save({ revision: 0, automation: row });
  await f.automations.redemption(event());
  await until(() => f.mics.get("one") === true);
  await f.automations.redemption({ ...event(), id: "second" });
  assert.equal(f.settlements[0].status, "CANCELED");
  await assert.rejects(f.automations.save({ revision: 1, automation: row }), {
    code: "control_deck_busy",
  });
  f.automations.cancel({ runId: f.automations.status().running[0].runId });
  await until(() => f.automations.status().running.length === 0);
  assert.deepEqual(
    [...f.mics],
    [
      ["one", false],
      ["two", true],
    ],
  );
  assert.equal(f.settlements.length, 1);
  assert.equal(f.automations.status().history[0].code, "control_deck_cancelled");
});
test("new rewards require explicit creation; deleting the actual reward requires its exact ID", async (t) => {
  const f = fixture(t),
    row = flow("c".repeat(24), { type: "reward", rewardId: "" });
  await f.automations.save({ revision: 0, automation: row });
  assert.equal(f.writes.length, 0);
  let result = await f.automations.reward({
    revision: 1,
    id: row.id,
    operation: "create",
    fields: { title: "Temporary mic switch", cost: 250, userInputRequired: false },
  });
  const saved = result.rows.find((item) => item.id === row.id);
  assert.equal(saved.trigger.rewardId, "created-1");
  await assert.rejects(
    f.automations.reward({
      revision: 2,
      id: row.id,
      operation: "delete",
      confirmRewardId: "wrong",
    }),
    { code: "twitch_reward_operation_invalid" },
  );
  result = await f.automations.reward({
    revision: 2,
    id: row.id,
    operation: "delete",
    confirmRewardId: "created-1",
  });
  assert.equal(result.rows.find((item) => item.id === row.id).enabled, false);
  assert.equal(result.rows.find((item) => item.id === row.id).trigger.rewardId, "");
  assert.equal(f.writes.filter((row) => row.operation === "delete").length, 1);
});
test("wrong-account events cannot run saved actions; reserved commands and revision races are rejected", async (t) => {
  const f = fixture(t),
    row = flow("d".repeat(24), { type: "command", command: "!songrequest" });
  await assert.rejects(f.automations.save({ revision: 0, automation: row }), {
    code: "twitch_automation_command_reserved",
  });
  row.trigger.command = "!mics";
  await f.automations.save({ revision: 0, automation: row });
  await assert.rejects(f.automations.save({ revision: 0, automation: row }), {
    code: "twitch_automation_revision_conflict",
  });
  f.setOwner("456");
  assert.equal(
    f.automations.status().rows.some((item) => item.id === row.id),
    false,
  );
  assert.equal(
    (
      await f.automations.chat({
        broadcaster_user_id: "123",
        chatter_user_id: "viewer",
        message_id: "other",
        message: { text: "!mics" },
      })
    ).handled,
    false,
  );
  assert.equal(f.calls.length, 0);
});
test("corrupt persisted configuration fails closed without reverting to legacy behavior", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(require("node:path").dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, "bad json");
  const broken = require("../src/domains/twitch/twitch-automations.service")(f.options);
  assert.equal(broken.status().ok, false);
  const result = await broken.redemption(event());
  assert.equal(result.handled, true);
  assert.equal(f.calls.length, 0);
  broken.shutdown();
});
