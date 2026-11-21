const test = require("node:test"),
  assert = require("node:assert/strict");
const fixture = require("./support/twitch-automation-fixture.cjs"),
  { flow, until } = fixture;
test("failure and shutdown restore remembered values while returning an unsuccessful result", async (t) => {
  const f = fixture(t),
    steps = flow().steps;
  steps.splice(2, 0, { actionId: "fixture.fail", params: {} });
  let run = f.deck.runAutomation("a".repeat(24), steps);
  assert.equal((await run.completion).ok, false);
  assert.deepEqual(
    [...f.mics],
    [
      ["one", false],
      ["two", true],
    ],
  );
  const pending = flow().steps;
  pending[2].params.durationMs = 60000;
  run = f.deck.runAutomation("b".repeat(24), pending);
  await until(() => f.mics.get("one") === true);
  await f.deck.shutdown();
  assert.equal((await run.completion).code, "control_deck_cancelled");
  assert.deepEqual(
    [...f.mics],
    [
      ["one", false],
      ["two", true],
    ],
  );
});
test("a second run cannot modify a target leased by an outstanding temporary flow", async (t) => {
  const f = fixture(t),
    steps = flow().steps;
  steps[2].params.durationMs = 60000;
  const first = f.deck.runAutomation("a".repeat(24), steps);
  await until(() => f.mics.get("one") === true);
  const second = f.deck.runAutomation("b".repeat(24), [
    { actionId: "fixture.mic.one", params: { muted: false } },
  ]);
  assert.equal((await second.completion).code, "control_deck_target_busy");
  f.deck.cancel(first.runId);
  await first.completion;
  assert.equal(f.mics.get("one"), false);
});
test("OBS restores the exact volume multiplier and refuses to restore into another collection", async () => {
  let volume = 0.632173,
    muted = false;
  const rows = new Map([
      ["vol", { kind: "volume", sourceName: "Mic" }],
      ["mute", { kind: "mute", sourceName: "Mic" }],
    ]),
    cache = { collection: "Original" };
  const get = require("../src/domains/control-deck/obs-restoration")({
    targets: { rows },
    cache,
    connected: () => true,
    request: async (method, value) => {
      if (method === "GetInputVolume") return { inputVolumeMul: volume };
      if (method === "SetInputVolume") volume = value.inputVolumeMul;
      if (method === "GetInputMute") return { inputMuted: muted };
      if (method === "SetInputMute") muted = value.inputMuted;
      return {};
    },
    notify: () => {},
    fault: (code) => Object.assign(Error(code), { code }),
  });
  const target = get("vol"),
    receipt = await target.capture();
  volume = 0.1;
  await target.restore(receipt);
  assert.equal(volume, 0.632173);
  const mic = get("mute"),
    saved = await mic.capture();
  muted = true;
  await mic.restore(saved);
  assert.equal(muted, false);
  cache.collection = "Different";
  await assert.rejects(target.restore(receipt), { code: "control_deck_restore_target_changed" });
});
test("remember/restore inside Together is rejected; unreadable snapshots stop before a target changes", async (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.deck.runAutomation("a".repeat(24), [{ type: "parallel", steps: [{ type: "remember" }] }]),
    { code: "control_deck_steps_invalid" },
  );
  f.actions.restorationTarget = () => ({
    key: "mic",
    capture: async () => {
      throw Error("unknown state");
    },
    restore: () => assert.fail("No receipt to restore"),
  });
  const run = f.deck.runAutomation("a".repeat(24), [
    { type: "remember" },
    { actionId: "fixture.mic.one", params: { muted: true } },
  ]);
  assert.equal((await run.completion).ok, false);
  assert.equal(f.calls.length, 0);
});
