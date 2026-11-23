const test = require("node:test"),
  assert = require("node:assert/strict");
const rules = require("../public/core/overlay-alert-rules");
const model = require("../public/core/overlay-model");
test("alert conditions select exact amounts, thresholds, tier and explicit priority deterministically", () => {
  const w = model.widget({
    type: "alerts",
    alertVariants: [
      { id: "base", event: "channel.cheer", minimum: 0, text: "any" },
      { id: "large", event: "channel.cheer", minimum: 1000, text: "large" },
      { id: "exact", event: "channel.cheer", minimum: 1000, maximum: 1000, text: "exact" },
      { id: "tier", event: "channel.subscribe", tier: "3000", text: "tier 3" },
      { id: "raid", event: "channel.raid", minimum: 25, text: "raid" },
      { id: "disabled", enabled: false, priority: 100, event: "channel.cheer", text: "disabled" },
    ],
  });
  assert.equal(rules.select(w, { type: "channel.cheer", amount: 1000 }).id, "exact");
  assert.equal(rules.select(w, { type: "channel.cheer", amount: 1500 }).id, "large");
  assert.equal(rules.select(w, { type: "channel.cheer", amount: 10 }).id, "base");
  assert.equal(rules.select(w, { type: "channel.subscribe", tier: "3000" }).id, "tier");
  assert.equal(rules.select(w, { type: "channel.subscribe", tier: "1000" }).text, w.text);
  assert.equal(rules.select(w, { type: "channel.raid", amount: 30 }).id, "raid");
  w.alertVariants[1].priority = 2;
  assert.equal(rules.select(w, { type: "channel.cheer", amount: 1000 }).id, "large");
});
test("alert assets and variations are bounded and viewer text is inserted literally", () => {
  assert.equal(rules.url("javascript:alert(1)"), "");
  assert.equal(rules.url("https://user:password@example.com/sound.mp3"), "");
  const w = model.widget({
    type: "alerts",
    alert: { soundUrl: "https://cdn.example.com/sound.mp3", volume: 200 },
    alertVariants: Array.from({ length: 50 }, () => ({ lifetime: 0 })),
  });
  assert.equal(w.alert.volume, 100);
  assert.equal(w.alertVariants.length, 32);
  assert.equal(w.alertVariants[0].lifetime, 1);
  assert.equal(
    rules.message("${name} ${amount}", { name: "${message}<script>", amount: 25 }),
    "${message}<script> 25",
  );
});
