const test = require("node:test"),
  assert = require("node:assert/strict");
function fixture() {
  let clock = 0,
    active = true,
    live = true,
    state = { connected: true, userId: "123", scopes: ["moderator:manage:shoutouts"] };
  const calls = [],
    timers = new Map(),
    results = [];
  const provider = {
    status: () => state,
    dashboardStream: async () => ({ ok: true, live }),
    runAction: async (input) => {
      calls.push(input.params.userId);
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result || { ok: true };
    },
  };
  const queue = require("../src/domains/twitch/shoutout-queue")({
    getProvider: () => provider,
    isActive: () => active,
    now: () => clock,
    schedule: (fn, delay) => {
      const id = {};
      timers.set(id, { fn, delay });
      return id;
    },
    unschedule: (id) => timers.delete(id),
  });
  return {
    queue,
    calls,
    results,
    timers,
    provider,
    add: (id, valid) => queue.enqueue({ target: "user-id", userId: id }, valid),
    async advance(ms) {
      clock += ms;
      await queue.tick();
    },
    setActive(value) {
      active = value;
    },
    setLive(value) {
      live = value;
    },
    setOwner(id) {
      state = { ...state, userId: id };
    },
  };
}
test("three raiders queue immediately, send in order at two-minute intervals and never repeat a recent target", async () => {
  const f = fixture();
  for (const id of ["456", "789", "1011"]) assert.equal(f.add(id).queued, true);
  assert.deepEqual(f.calls, [], "admission never holds the automation waiting for a network write");
  assert.equal(f.add("789").duplicate, true);
  assert.equal(f.timers.size, 1);
  await f.queue.tick();
  assert.deepEqual(f.calls, ["456"]);
  await f.advance(120000);
  assert.equal(f.calls.length, 1);
  await f.advance(251);
  assert.deepEqual(f.calls, ["456", "789"]);
  await f.advance(120251);
  assert.deepEqual(f.calls, ["456", "789", "1011"]);
  assert.equal(f.add("456").duplicate, true);
  assert.equal(f.queue.snapshot().pending, 0);
  assert.equal(f.timers.size, 0);
});
test("Twitch's moderator shoutout event supplies authoritative cooldowns and removes already-shouted queue entries", async () => {
  const f = fixture();
  f.add("456");
  f.add("789");
  f.queue.receive("channel.shoutout.create", {
    broadcaster_user_id: "123",
    to_broadcaster_user_id: "456",
    cooldown_ends_at: new Date(120000).toISOString(),
    target_cooldown_ends_at: new Date(3600000).toISOString(),
  });
  assert.equal(f.queue.snapshot().pending, 1);
  await f.advance(120000);
  assert.deepEqual(f.calls, []);
  await f.advance(251);
  assert.deepEqual(f.calls, ["789"]);
  assert.equal(f.add("456").duplicate, true);
});
test("explicit rate rejection waits before a bounded retry; uncertain writes are never replayed", async () => {
  const f = fixture();
  f.results.push({ ok: false, error: "twitch_action_cooldown", status: 429 });
  f.add("456");
  await f.queue.tick();
  assert.equal(f.calls.length, 1);
  await f.advance(120000);
  assert.equal(f.calls.length, 1);
  await f.advance(1001);
  assert.equal(f.calls.length, 2);
  assert.equal(f.queue.snapshot().pending, 0);
  const uncertain = fixture();
  uncertain.results.push(new Error("response lost"));
  uncertain.add("456");
  uncertain.add("789");
  await uncertain.queue.tick();
  await uncertain.advance(121001);
  assert.deepEqual(uncertain.calls, ["456", "789"]);
  assert.equal(uncertain.queue.snapshot().pending, 0);
  const limited = fixture();
  limited.results.push(
    ...Array(3).fill({ ok: false, error: "twitch_action_cooldown", status: 429 }),
  );
  limited.add("456");
  await limited.queue.tick();
  for (let n = 0; n < 4; n++) await limited.advance(121001);
  assert.equal(limited.calls.length, 3);
  assert.equal(limited.queue.snapshot().pending, 0);
});

test("cooldown subscription uses broadcaster/moderator identity and the existing native permission", () => {
  const row = require("../src/capabilities/feature-platform/providers/twitch-automation-events")
    .definitions("123")
    .find((item) => item.type === "channel.shoutout.create");
  assert.equal(row.scope, "moderator:manage:shoutouts");
  assert.deepEqual(row.condition, { broadcaster_user_id: "123", moderator_user_id: "123" });
});
test("offline, disabled, changed-owner and obsolete-flow queues discard work and the list stays bounded", async () => {
  for (const mode of ["offline", "disabled", "owner", "paused"]) {
    const f = fixture();
    let current = true;
    f.add("456", () => current);
    if (mode === "offline") f.setLive(false);
    if (mode === "disabled") f.setActive(false);
    if (mode === "owner") f.setOwner("999");
    if (mode === "paused") current = false;
    await f.queue.tick();
    assert.deepEqual(f.calls, [], mode);
    assert.equal(f.queue.snapshot().pending, 0);
  }
  const f = fixture();
  for (let n = 0; n < 32; n++) assert.equal(f.add(String(n + 1000)).ok, true);
  assert.equal(f.add("99999").error, "twitch_shoutout_queue_full");
  assert.equal(f.timers.size, 1);
  f.queue.receive("stream.offline", { broadcaster_user_id: "123" });
  assert.equal(f.queue.snapshot().pending, 0);
  assert.equal(f.timers.size, 0);
});
test("an account change while checking stream state cannot send a queued target under the new account", async () => {
  const f = fixture();
  let resolve;
  f.provider.dashboardStream = () =>
    new Promise((done) => {
      resolve = done;
    });
  f.add("456");
  const pending = f.queue.tick();
  f.setOwner("999");
  resolve({ ok: true, live: true });
  await pending;
  assert.deepEqual(f.calls, []);
  assert.equal(f.queue.snapshot().pending, 0);
});
test("back-to-back raids retain their complete flow while a previous raid action is busy", async (t) => {
  const flows = require("./support/twitch-automation-fixture.cjs"),
    f = flows(t),
    original = f.provider.status;
  f.provider.status = () => ({
    ...original(),
    scopes: [...original().scopes, "moderator:manage:shoutouts"],
  });
  const row = flows.flow("f".repeat(24), { type: "event", event: "channel.raid" });
  row.cooldownSeconds = 0;
  row.steps = [
    { actionId: "deck.wait", params: { durationMs: 25 } },
    { actionId: "twitch.action.shoutout", params: { target: "raider" } },
  ];
  await f.automations.save({ revision: f.automations.status().revision, automation: row });
  f.automations.setActive(true);
  await Promise.all(
    ["456", "789", "1011"].map((id) =>
      f.automations.event(
        "channel.raid",
        {
          to_broadcaster_user_id: "123",
          from_broadcaster_user_id: id,
          from_broadcaster_user_login: "raider" + id,
          viewers: 5,
        },
        { message_id: "raid-" + id },
      ),
    ),
  );
  await flows.until(
    () =>
      f.automations.status().history.length === 3 && !f.twitchActions.shoutouts.snapshot().sending,
  );
  assert.equal(f.twitchActions.shoutouts.snapshot().pending, 2);
  f.advanceQueue(120251);
  await f.twitchActions.shoutouts.tick();
  f.advanceQueue(120251);
  await f.twitchActions.shoutouts.tick();
  assert.deepEqual(
    f.calls.filter((call) => call.twitch).map((call) => call.twitch.params.userId),
    ["456", "789", "1011"],
  );
});
