const test = require("node:test"),
  assert = require("node:assert/strict");
const presets = require("../src/domains/twitch/streamer-automation-presets"),
  fixture = require("./support/twitch-automation-fixture.cjs");
test("streamer presets save as inactive editable flows using supported actions without running anything", async (t) => {
  const f = fixture(t),
    ids = new Set();
  for (const [index, preset] of presets.entries()) {
    assert.ok(!ids.has(preset.id));
    ids.add(preset.id);
    await f.automations.save({
      revision: f.automations.status().revision,
      automation: {
        id: index.toString(16).padStart(24, "0"),
        name: preset.name,
        enabled: false,
        trigger: preset.trigger,
        handler: "flow",
        steps: preset.steps,
        role: preset.role,
        cooldownSeconds: preset.cooldownSeconds,
        userCooldownSeconds: preset.userCooldownSeconds,
      },
    });
    const stored = f.automations.status().rows.find((row) => row.name === preset.name);
    assert.equal(stored.enabled, false);
    assert.deepEqual(
      stored.steps,
      preset.steps.map((step) => step),
    );
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(presets.find((row) => row.id === "raid-native").steps[0].params.target, "raider");
});

const savePreset = async (f, name, id) => {
  const preset = presets.find((row) => row.id === name);
  await f.automations.save({
    revision: f.automations.status().revision,
    automation: {
      id: id.toString(16).padStart(24, "0"),
      name: preset.name,
      enabled: true,
      trigger: preset.trigger,
      handler: "flow",
      steps: preset.steps,
      role: preset.role,
      cooldownSeconds: preset.cooldownSeconds,
      userCooldownSeconds: preset.userCooldownSeconds,
    },
  });
};

test("stream record presets enforce roles, share counters and require reset confirmation", async (t) => {
  const f = fixture(t);
  for (const [i, name] of ["win", "loss", "record", "resetrecord"].entries())
    await savePreset(f, name, i + 1);
  let serial = 0;
  const send = async (text, role) => {
    const result = await f.automations.chat({
      broadcaster_user_id: "123",
      broadcaster_user_login: "streamer",
      chatter_user_id: role === "broadcaster" ? "123" : "456",
      chatter_user_login: "chatter",
      message_id: "record-" + ++serial,
      message: { text },
      badges: role === "viewer" ? [] : [{ set_id: role }],
    });
    if (result.accepted) await fixture.until(() => f.automations.status().running.length === 0);
    return result;
  };
  assert.equal((await send("!win", "viewer")).code, "twitch_automation_role_required");
  assert.equal((await send("!win", "moderator")).accepted, true);
  assert.equal((await send("!loss", "moderator")).accepted, true);
  assert.equal((await send("!record", "viewer")).accepted, true);
  assert.equal(f.calls.at(-1).twitch.params.message, "Wins: 1 | Losses: 1");
  assert.equal(
    (await send("!resetrecord confirm", "moderator")).code,
    "twitch_automation_role_required",
  );
  const resetMessage = presets.find((row) => row.id === "resetrecord").steps[0].params.message;
  const preview = await f.automations.preview({ template: resetMessage, arguments: "" });
  assert.match(preview.text, /Type !resetrecord confirm/);
  assert.equal((await send("!resetrecord", "broadcaster")).accepted, true);
  assert.match(f.calls.at(-1).twitch.params.message, /Type !resetrecord confirm/);
  // Reopen the owner to prove both the declined reset and saved totals survive restart.
  f.automations.shutdown();
  const reopened = require("../src/domains/twitch/twitch-automations.service")(f.options);
  t.after(() => reopened.shutdown());
  const recordMessage = presets.find((row) => row.id === "record").steps[0].params.message;
  assert.equal((await reopened.preview({ template: recordMessage })).text, "Wins: 1 | Losses: 1");
  // Preview runs the exact confirmation branch against a temporary transaction.
  assert.equal(
    (await reopened.preview({ template: resetMessage, arguments: "confirm" })).text,
    "Record reset. Wins: 0 | Losses: 0",
  );
  assert.equal((await reopened.preview({ template: recordMessage })).text, "Wins: 1 | Losses: 1");
});

test("large cheer and gift presets only post at their thresholds, including anonymous events", async (t) => {
  const f = fixture(t);
  await savePreset(f, "bits-milestone", 1);
  await savePreset(f, "gift-milestone", 2);
  f.automations.setActive(true);
  let completed = 0;
  const send = async (type, values) => {
    await f.automations.event(
      type,
      { broadcaster_user_id: "123", is_anonymous: true, ...values },
      { message_id: "threshold-" + ++completed },
    );
    await fixture.until(() => f.automations.status().history.length === completed);
  };
  await send("channel.cheer", { bits: 999 });
  assert.equal(f.calls.length, 0);
  await send("channel.cheer", { bits: 1000 });
  assert.match(f.calls.at(-1).twitch.params.message, /1000 Bits/);
  await send("channel.subscription.gift", { total: 4 });
  assert.equal(f.calls.length, 1);
  await send("channel.subscription.gift", { total: 5 });
  assert.match(f.calls.at(-1).twitch.params.message, /5 gifted subscriptions/);
  assert.equal(f.calls.length, 2);
});
