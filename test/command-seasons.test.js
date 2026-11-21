const savedCounters = require("./support/counter-snapshot.cjs");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { render } = require("../src/domains/twitch/command-template");
const recipe = require("../public/core/recipes/seasons.json")
  .stages.map((row) => row.source)
  .join("\n");
test("generic archive, bulk reset and counter functions implement seasons atomically and survive restart", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-seasons-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "records.json"),
    create = require("../src/domains/twitch/command-counters"),
    owner = create(file);
  const seed = owner("channel", false, true);
  for (const [person, xp] of [
    ["first", 90],
    ["second", 80],
    ["third", 70],
    ["fourth", 20],
  ]) {
    seed("player " + person + " xp", "set", xp);
    seed("player " + person + " wins", "set", 5);
  }
  seed.commit();
  const before = savedCounters(file),
    preview = owner("channel", true, true);
  assert.match(await render(recipe, { counter: preview }), /S1: 1\. first: 90.*S2 begins/);
  preview.commit();
  assert.equal(savedCounters(file), before);
  const failed = owner("channel", false, true);
  await assert.rejects(render(recipe + "${unknown}", { counter: failed }));
  assert.equal(savedCounters(file), before);
  const turn = owner("channel", false, true);
  const text = await render(recipe, { counter: turn });
  turn.commit();
  assert.match(text, /S1: 1\. first: 90.*2\. second: 80.*3\. third: 70/);
  assert.doesNotMatch(text, /fourth/);
  const next = create(file)("channel", false, true);
  assert.equal(await render("${set saved boards}${saved}", { counter: next }), "S1");
  assert.equal(next("player first xp", "get"), 0);
  assert.equal(next("player first wins", "get"), 5);
  assert.equal(next("season", "get"), 2);
  next("player fourth xp", "set", 100);
  next.commit();
  assert.equal(
    await render('${board "S1"}', { counter: create(file)("channel", true, true) }),
    "S1: 1. first: 90 · 2. second: 80 · 3. third: 70",
  );
  const second = create(file)("channel", false, true);
  await render(recipe, { counter: second });
  second.commit();
  assert.equal(
    await render("${boards}", { counter: create(file)("channel", true, true) }),
    "S1, S2",
  );
  assert.match(
    await render('${board "S2"}', { counter: create(file)("other", true, true) }),
    /No saved leaderboard/,
  );
  const duplicate = create(file)("channel", false, true);
  await assert.rejects(render('${saveboard "S1" xp 3}', { counter: duplicate }), /already saved/);
  await assert.rejects(render("${constructor}", { counter: duplicate }), /Unknown/);
});
test("calendar schedules keep month boundaries and skip missed periods without a burst", () => {
  const { advance, future } = require("../src/domains/twitch/calendar-schedule");
  const jan = Date.UTC(2028, 0, 31, 12);
  const feb = advance(jan, 1, 31);
  assert.equal(new Date(feb).toISOString(), "2028-02-29T12:00:00.000Z");
  assert.equal(new Date(advance(feb, 1, 31)).toISOString(), "2028-03-31T12:00:00.000Z");
  assert.equal(new Date(advance(jan, 2, 31)).toISOString(), "2028-03-31T12:00:00.000Z");
  assert.equal(
    new Date(future(jan, 2, Date.UTC(2028, 7, 15), 31)).toISOString(),
    "2028-09-30T12:00:00.000Z",
  );
  assert.throws(() => advance(jan, 2, 0), /Invalid calendar/);
  assert.throws(() => advance(8640000000000000, 2), /Invalid calendar/);
});

test("a saved calendar automation rolls over without chat access and retains its date after service restart", async (t) => {
  const fixture = require("./support/twitch-automation-fixture.cjs"),
    f = fixture(t),
    create = require("../src/domains/twitch/twitch-automations.service");
  f.automations.shutdown();
  f.provider.status = () => ({ connected: true, userId: "123", scopes: [], managedRewards: [] });
  let now = Date.UTC(2028, 0, 31, 12);
  const counterFile = f.file.replace(".json", ".counters.json");
  fs.mkdirSync(path.dirname(counterFile), { recursive: true });
  fs.writeFileSync(
    counterFile,
    JSON.stringify({ "123:player hero xp": 120, "123:player hero wins": 3 }),
  );
  let service = create({ ...f.options, now: () => now });
  t.after(() => service.shutdown());
  const row = fixture.flow("e".repeat(24), {
    type: "timer",
    calendarMonths: 2,
    nextAt: now,
    calendarDay: 31,
    repeatLimit: 0,
    onlyLive: false,
    minMessages: 0,
  });
  row.steps = [{ actionId: "twitch.action.recipe", params: { message: recipe } }];
  await service.save({ revision: 0, automation: row });
  service.setActive(true);
  await service.tick();
  await fixture.until(() => service.status().running.length === 0);
  assert.equal(service.status().history[0].ok, true);
  assert.equal(f.calls.length, 0, "saved-value recipes never post a chat message");
  const stored = savedCounters(counterFile);
  assert.equal(JSON.parse(stored).values["123:season"], 2);
  assert.equal(JSON.parse(stored).values["123:player hero xp"], 0);
  assert.equal(JSON.parse(stored).values["123:player hero wins"], 3);
  const nextAt = service.status().rows.find((item) => item.id === row.id).trigger.nextAt;
  assert.equal(nextAt, Date.UTC(2028, 2, 31, 12));
  service.shutdown();
  service = create({ ...f.options, now: () => now });
  service.setActive(true);
  await service.tick();
  assert.equal(savedCounters(counterFile), stored);
  assert.equal(service.status().rows.find((item) => item.id === row.id).trigger.nextAt, nextAt);
  now = Date.UTC(2028, 1, 15, 12);
  await service.control({ id: row.id, operation: "pause" });
  await service.control({ id: row.id, operation: "start" });
  assert.equal(service.status().rows.find((item) => item.id === row.id).trigger.nextAt, nextAt);
  await service.control({ id: row.id, operation: "restart" });
  assert.equal(
    service.status().rows.find((item) => item.id === row.id).trigger.nextAt,
    Date.UTC(2028, 3, 15, 12),
  );
  assert.equal(savedCounters(counterFile), stored);
});

test("cancelled or unavailable variable actions cannot change saved records", async () => {
  let renders = 0,
    active = true;
  const actions = require("../src/domains/twitch/twitch-flow-actions")({
    getProvider: () => ({ status: () => ({ connected: true, scopes: [] }) }),
    isActive: () => active,
    getAutomations: () => ({
      actions: { handles: () => false, catalog: () => [] },
      renderMessage: async () => {
        renders++;
        return "";
      },
    }),
  });
  try {
    const signal = AbortSignal.abort();
    await assert.rejects(
      actions.execute("twitch.action.recipe", { message: "${resetstats xp}" }, signal),
      /cancelled/,
    );
    active = false;
    assert.equal(
      (await actions.execute("twitch.action.recipe", { message: "${resetstats xp}" })).ok,
      false,
    );
    active = true;
    assert.equal(
      (await actions.execute("twitch.action.chat", { message: "${counttest}" })).ok,
      false,
    );
    assert.equal(renders, 0);
    assert.equal(
      (await actions.execute("twitch.action.recipe", { message: "${resetstats xp}" })).ok,
      true,
    );
    assert.equal(renders, 1);
  } finally {
    actions.shutdown();
  }
});

test("the manual XP reset preset requires the broadcaster and confirmation before changing anyone's XP", async (t) => {
  const fixture = require("./support/twitch-automation-fixture.cjs"),
    f = fixture(t),
    preset = require("../src/domains/twitch/streamer-automation-presets").find(
      (row) => row.id === "reset-xp",
    );
  await f.automations.renderMessage("${setstat hero xp 120}${setstat hero wins 3}");
  await f.automations.save({
    revision: 0,
    automation: {
      ...fixture.flow("d".repeat(24), preset.trigger),
      name: preset.name,
      role: preset.role,
      steps: preset.steps,
      cooldownSeconds: 0,
      userCooldownSeconds: 0,
    },
  });
  const before = savedCounters(f.file.replace(".json", ".counters.json"));
  const input = (text, id, user = "123") => ({
    broadcaster_user_id: "123",
    chatter_user_id: user,
    chatter_user_login: "host",
    message_id: id,
    message: { text },
    badges: [],
  });
  assert.equal(
    (await f.automations.chat(input("!resetxp confirm", "viewer", "456"))).code,
    "twitch_automation_role_required",
  );
  assert.equal((await f.automations.chat(input("!resetxp", "unconfirmed"))).accepted, true);
  await fixture.until(() => f.automations.status().running.length === 0);
  assert.equal(savedCounters(f.file.replace(".json", ".counters.json")), before);
  assert.match(f.calls.at(-1).twitch.params.message, /Type !resetxp confirm/);
  assert.equal((await f.automations.chat(input("!resetxp confirm", "confirmed"))).accepted, true);
  await fixture.until(() => f.automations.status().running.length === 0);
  assert.equal(await f.automations.renderMessage("${stat hero xp}"), "0");
  assert.equal(await f.automations.renderMessage("${stat hero wins}"), "3");
});
test("calendar timers persist the next UTC date and do not replay a completed period after restart", async (t) => {
  const create = require("../src/domains/twitch/twitch-automation-triggers");
  let now = Date.UTC(2028, 0, 31, 12),
    runs = 0;
  const row = {
    id: "season",
    accountId: "owner",
    enabled: true,
    trigger: {
      type: "timer",
      calendarMonths: 2,
      nextAt: now,
      calendarDay: 31,
      onlyLive: false,
      minMessages: 0,
      repeatLimit: 0,
    },
  };
  const make = () =>
    create({
      rows: () => [row],
      account: () => "owner",
      getProvider: () => ({}),
      now: () => now,
      launch: () => {
        runs++;
        return { accepted: true };
      },
      receipt: () => true,
      advanceCalendar: async (r, nextAt) => {
        r.trigger = { ...r.trigger, nextAt };
      },
    });
  let scheduler = make();
  t.after(() => scheduler.close());
  scheduler.setActive(true);
  await scheduler.tick();
  assert.equal(runs, 1);
  assert.equal(new Date(row.trigger.nextAt).toISOString(), "2028-03-31T12:00:00.000Z");
  scheduler.close();
  scheduler = make();
  scheduler.setActive(true);
  await scheduler.tick();
  assert.equal(runs, 1);
  now = Date.UTC(2028, 7, 15);
  await scheduler.tick();
  assert.equal(runs, 2);
  assert.equal(new Date(row.trigger.nextAt).toISOString(), "2028-09-30T12:00:00.000Z");
  row.enabled = false;
  now = Date.UTC(2029, 1, 1);
  await scheduler.tick();
  assert.equal(runs, 2);
  row.enabled = true;
  await scheduler.tick();
  assert.equal(runs, 3);
  await scheduler.tick();
  assert.equal(runs, 3);
});
