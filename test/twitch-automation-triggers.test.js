const test = require("node:test"),
  assert = require("node:assert/strict");
const create = require("../src/domains/twitch/twitch-automation-triggers"),
  fixture = require("./support/twitch-automation-fixture.cjs"),
  { flow, until } = fixture;
function timerFixture(t, trigger = {}) {
  let clock = 0,
    live = true;
  const calls = [],
    rows = [
      {
        id: "timer",
        accountId: "123",
        enabled: true,
        trigger: {
          type: "timer",
          intervalMs: 30000,
          repeatLimit: 2,
          onlyLive: false,
          minMessages: 2,
          ...trigger,
        },
      },
    ];
  const scheduler = create({
    rows: () => rows,
    account: () => "123",
    getProvider: () => ({ dashboardStream: async () => ({ ok: true, live }) }),
    now: () => clock,
    launch: (row) => {
      calls.push(row.id);
      return { accepted: true };
    },
    receipt: () => true,
  });
  scheduler.setActive(true);
  t.after(() => scheduler.close());
  return {
    scheduler,
    rows,
    calls,
    advance: (ms) => {
      clock += ms;
    },
    setLive: (value) => {
      live = value;
    },
  };
}
test("timer waits at its interval for new viewer messages, deduplicates them, runs once and respects a finite count", async (t) => {
  const f = timerFixture(t);
  await f.scheduler.tick();
  f.advance(30000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].phase, "waiting_chat");
  const message = (id) => ({ broadcaster_user_id: "123", chatter_user_id: "456", message_id: id });
  f.scheduler.chat(message("one"));
  f.scheduler.chat(message("one"));
  await f.scheduler.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.scheduler.snapshot()[0].messages, 1);
  f.scheduler.chat(message("two"));
  await until(() => f.calls.length === 1);
  f.advance(1000000);
  await f.scheduler.tick();
  assert.equal(f.calls.length, 1, "no catch-up burst");
  f.scheduler.chat(message("three"));
  f.scheduler.chat(message("four"));
  await until(() => f.calls.length === 2);
  f.advance(1000000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].phase, "completed");
  assert.equal(f.calls.length, 2);
});
test("pausing and going offline retain the remaining timer time; infinite timers resume without catch-up", async (t) => {
  const f = timerFixture(t, { minMessages: 0, repeatLimit: 0, onlyLive: true });
  await f.scheduler.tick();
  f.advance(10000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].remaining, 20000);
  f.rows[0].enabled = false;
  f.scheduler.sync();
  f.advance(100000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].remaining, 20000);
  f.rows[0].enabled = true;
  f.setLive(false);
  f.advance(30000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].phase, "waiting_live");
  f.setLive(true);
  f.advance(30000);
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot()[0].remaining, 20000);
  f.advance(20000);
  await f.scheduler.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.scheduler.snapshot()[0].remaining, 30000);
});
test("raid events carry safe text values, are durably deduplicated, and saved automation controls can pause them", async (t) => {
  const f = fixture(t),
    row = flow("e".repeat(24), { type: "event", event: "channel.raid" });
  row.steps = [{ actionId: "fixture.mic.one", params: { muted: true } }];
  row.cooldownSeconds = 0;
  await f.automations.save({ revision: 0, automation: row });
  f.automations.setActive(true);
  const event = {
    to_broadcaster_user_id: "123",
    from_broadcaster_user_id: "456",
    from_broadcaster_user_login: "raider_name",
    viewers: 25,
  };
  await f.automations.event("channel.raid", event, { message_id: "raid-1" });
  await until(() => f.automations.status().history.length === 1);
  assert.equal(f.calls.length, 1);
  await f.automations.event("channel.raid", event, { message_id: "raid-1" });
  assert.equal(f.calls.length, 1);
  const paused = await f.automations.actions.execute("twitch.automation.pause:" + row.id);
  assert.equal(paused.enabled, false);
  await f.automations.event("channel.raid", event, { message_id: "raid-2" });
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.automations.actions
      .catalog()
      .some((action) => action.id === "twitch.automation.start:" + row.id),
    true,
  );
});
test("only timer automations offer restart controls; unsupported saved controls still fail validation", () => {
  const rows = ["reward", "command", "event", "timer"].map((type, i) => ({
    id: String(i).padStart(24, "0"),
    name: type,
    enabled: true,
    trigger: { type },
  }));
  const controls = require("../src/domains/twitch/twitch-automation-controls")({
    getRows: () => rows,
    account: () => "owner",
    control() {},
  });
  const actions = controls.catalog();
  assert.equal(actions.filter((row) => row.id.startsWith("twitch.automation.restart:")).length, 1);
  assert.equal(
    actions.find((row) => row.id.startsWith("twitch.automation.restart:")).label,
    "Restart timer · timer",
  );
  assert.throws(
    () =>
      require("../src/domains/twitch/twitch-automation-controls").prepare(
        rows[0],
        "restart",
        false,
        Date.now(),
      ),
    /trigger_invalid/,
  );
});

test("event templates only enter Twitch text/shoutout fields; a missing raider never guesses a target", () => {
  const { fromEvent, parameters } = require("../src/domains/twitch/twitch-automation-context");
  const context = fromEvent("channel.raid", {
    from_broadcaster_user_id: "456",
    from_broadcaster_user_login: "raider_name",
    viewers: 25,
  });
  assert.deepEqual(
    parameters(
      "twitch.action.chat",
      { message: "Welcome {raider} and {viewers} viewers!" },
      context,
    ),
    { message: "Welcome raider_name and 25 viewers!" },
  );
  assert.deepEqual(
    parameters("twitch.action.shoutout", { target: "raider", userId: "" }, context),
    { target: "user-id", userId: "456" },
  );
  assert.deepEqual(
    parameters(
      "twitch.action.bot-shoutout",
      { target: "raider", login: "", command: "!so" },
      context,
    ),
    { target: "login", login: "raider_name", command: "!so" },
  );
  assert.deepEqual(
    parameters("native.hotkey", { shortcut: "{raider}" }, context),
    { shortcut: "{raider}" },
    "event text is never interpolated into desktop input",
  );
  assert.throws(() => parameters("twitch.action.shoutout", { target: "raider" }, undefined), {
    code: "twitch_event_value_missing",
  });
});

test("disabling the feature during a live-status read cannot start an overdue timer afterwards", async (t) => {
  let clock = 0,
    release,
    block = false;
  const calls = [],
    rows = [
      {
        id: "timer",
        accountId: "123",
        enabled: true,
        trigger: {
          type: "timer",
          intervalMs: 1000,
          repeatLimit: 0,
          onlyLive: true,
          minMessages: 0,
        },
      },
    ];
  const scheduler = create({
    rows: () => rows,
    account: () => "123",
    getProvider: () => ({
      dashboardStream: () =>
        block
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ ok: true, live: true }),
    }),
    launch: () => {
      calls.push("run");
      return { accepted: true };
    },
    receipt: () => true,
    now: () => clock,
  });
  t.after(() => scheduler.close());
  scheduler.setActive(true);
  await scheduler.tick();
  clock = 31000;
  block = true;
  const tick = scheduler.tick();
  scheduler.setActive(false);
  release({ ok: true, live: true });
  await tick;
  assert.equal(calls.length, 0);
});
