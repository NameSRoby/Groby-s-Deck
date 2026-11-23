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
test("goal recipes handle live events, broadcaster updates and overlay reads through saved counters", async (t) => {
  const f = fixture(t);
  const { until } = fixture;
  const { widget, recordKey } = require("../public/core/overlay-model");
  const goal = (name) =>
    widget({
      type: "goal",
      goalSource: "counter",
      goalCounter: "goal-" + name,
      goalTargetCounter: "goal-" + name + "-target",
    });
  const followers = goal("followers"),
    subs = goal("subscribers"),
    bits = goal("bits"),
    donations = goal("donations"),
    widgets = [followers, subs, bits, donations];
  const progress = (w) => f.automations.overlayRecords(widgets)[recordKey(w)];
  for (const [index, preset] of presets.filter((row) => row.group === "Goals").entries()) {
    const { name, trigger, steps, role } = preset;
    await f.automations.save({
      revision: f.automations.status().revision,
      automation: {
        id: (index + 1).toString(16).padStart(24, "0"),
        name,
        enabled: true,
        trigger,
        steps,
        role,
        handler: "flow",
        cooldownSeconds: 0,
        userCooldownSeconds: 0,
      },
    });
  }
  f.automations.setActive(true);
  const event = { broadcaster_user_id: "123", user_id: "456", user_login: "demo" };
  await Promise.all([
    f.automations.event("channel.follow", event, { message_id: "follow-one" }),
    f.automations.event("channel.follow", event, { message_id: "follow-one" }),
    f.automations.event("channel.follow", event, { message_id: "follow-two" }),
  ]);
  await f.automations.event("channel.subscribe", event, { message_id: "sub-one" });
  await f.automations.event("channel.cheer", { ...event, bits: 250 }, { message_id: "bits-one" });
  await until(() => progress(bits)?.value === 250);
  await until(() => progress(followers).value === 2);
  assert.equal(progress(subs).value, 1);
  assert.equal(f.calls.length, 0, "Event goals do not post chat");
  const command = (text, id, chatter = "123") =>
    f.automations.chat({
      broadcaster_user_id: "123",
      chatter_user_id: chatter,
      chatter_user_login: "demo",
      message_id: id,
      message: { text },
    });
  await command("!adddonation 2500", "unprivileged", "456");
  assert.equal(progress(donations).value, 0);
  await command("!adddonation 1250", "operator");
  await until(() => progress(donations).value === 1250);
  await command("!goaltarget followers 20", "target");
  await until(() => progress(followers).target === 20);
  await command("!goalprogress followers 0", "reset");
  await until(() => progress(followers).value === 0);
  assert.equal(progress(followers).target, 20);
  f.setOwner("789");
  assert.equal(progress(donations).value, 0);
});
