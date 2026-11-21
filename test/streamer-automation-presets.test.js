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
