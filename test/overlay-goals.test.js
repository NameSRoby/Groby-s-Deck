const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const make = require("../src/domains/overlays/overlay-goals");
const sources = require("../public/core/overlay-goal-sources");
function fixture(t) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-goals-"));
  let at = 100000;
  const create = () => make({ runtimeDir, now: () => at });
  const goals = create();
  t.after(() => {
    goals.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const add = (name, tracking, target = 100, extra = {}) => {
    const tx = goals.transaction("123");
    tx.create({ name, tracking, target, ...extra });
    tx.commit();
  };
  return {
    goals,
    add,
    create,
    advance: (ms) => {
      at += ms;
    },
  };
}
test("all Twitch tracking sources have goal presets and supported event definitions", () => {
  const presets = require("../src/domains/twitch/streamer-automation-presets");
  const events =
    require("../src/capabilities/feature-platform/providers/twitch-automation-events").EVENTS.map(
      (e) => e[0],
    );
  for (const source of sources.sources) {
    assert.ok(presets.some((p) => p.id === "track-goal-" + source.id));
    if (
      source.event &&
      source.event !== "channel.chat.message" &&
      !source.event.endsWith("redemption.add")
    )
      assert.ok(events.includes(source.event), source.event);
  }
  assert.equal(presets.find((p) => p.id === "goal-donations").trigger.type, "timer");
  assert.equal(presets.find((p) => p.id === "add-goal").trigger.command, "!addgoal");
});
test("goals persist, deduplicate events, separate Twitch accounts and stop at their deadline", (t) => {
  const f = fixture(t);
  f.add("community", "bits", 100, { endsAt: 102000 });
  f.goals.receive("123", "channel.cheer", { bits: 75 }, { message_id: "a" });
  f.goals.receive("123", "channel.cheer", { bits: 75 }, { message_id: "a" });
  f.goals.receive("456", "channel.cheer", { bits: 90 }, { message_id: "b" });
  f.goals.flush();
  const restarted = f.create();
  assert.equal(restarted.snapshot("123").community.current, 75);
  assert.deepEqual(restarted.snapshot("456"), {});
  assert.equal(restarted.snapshot("123").community.seen, undefined);
  f.advance(2000);
  f.goals.receive("123", "channel.cheer", { bits: 100 }, { message_id: "c" });
  assert.equal(f.goals.snapshot("123").community.current, 75);
  assert.equal(f.goals.snapshot("123").community.ended, true);
});
test("charity goals use Twitch currency precision and never mix currencies", (t) => {
  const f = fixture(t);
  f.add("charity", "donations", 100);
  f.goals.receive("123", "channel.charity_campaign.donate", {
    id: "one",
    amount: { value: 1250, decimal_places: 2, currency: "EUR" },
  });
  f.goals.receive("123", "channel.charity_campaign.donate", {
    id: "two",
    amount: { value: 2000, decimal_places: 2, currency: "USD" },
  });
  f.goals.receive("123", "channel.charity_campaign.donate", {
    id: "three",
    amount: { value: 250, decimal_places: 2, currency: "EUR" },
  });
  assert.equal(f.goals.snapshot("123").charity.current, 15);
  assert.equal(f.goals.snapshot("123").charity.currency, "EUR");
  f.add("yen", "donations", 10000, { currency: "JPY" });
  f.goals.receive("123", "channel.charity_campaign.donate", {
    id: "yen",
    amount: { value: 500, decimal_places: 0, currency: "JPY" },
  });
  assert.equal(f.goals.snapshot("123").yen.current, 500);
});
test("current-reading goals update from snapshots; event goals accumulate real quantities", (t) => {
  const f = fixture(t);
  for (const name of [
    "viewers",
    "follower-total",
    "subscriber-total",
    "subscription-points",
    "uptime",
    "gift-subscriptions",
    "raiders",
    "redeemed-points",
    "poll-votes",
  ])
    f.add(name, name);
  f.goals.update("123", {
    stream: { ok: true, live: true, viewers: 42, startedAt: 40000 },
    followers: { ok: true, total: 900 },
    subscribers: { ok: true, total: 50, points: 65 },
  });
  assert.equal(f.goals.snapshot("123").viewers.current, 42);
  assert.equal(f.goals.snapshot("123").uptime.current, 1);
  assert.equal(f.goals.snapshot("123")["subscription-points"].current, 65);
  f.goals.receive("123", "channel.subscription.gift", { total: 5 }, { message_id: "gift" });
  f.goals.receive("123", "channel.raid", { viewers: 30 }, { message_id: "raid" });
  f.goals.receive("123", "channel.channel_points_custom_reward_redemption.add", {
    id: "redemption",
    reward: { cost: 2000 },
  });
  f.goals.receive(
    "123",
    "channel.poll.progress",
    { id: "poll", choices: [{ votes: 10 }, { votes: 12 }] },
    { message_id: "poll1" },
  );
  f.goals.receive(
    "123",
    "channel.poll.progress",
    { id: "poll", choices: [{ votes: 11 }, { votes: 14 }] },
    { message_id: "poll2" },
  );
  const state = f.goals.snapshot("123");
  assert.equal(state["gift-subscriptions"].current, 5);
  assert.equal(state.raiders.current, 30);
  assert.equal(state["redeemed-points"].current, 2000);
  assert.equal(state["poll-votes"].current, 25);
});
test("template goal controls commit only on success; previews and concurrent event updates are preserved", async (t) => {
  const f = fixture(t),
    render = require("../src/domains/twitch/command-template").render;
  const tx = f.goals.transaction("123");
  assert.match(
    await render("${addgoal ${1} ${2} ${3}}", {
      context: { argv: ["community", "bits", "1000"] },
      goals: tx,
    }),
    /1000/,
  );
  assert.deepEqual(f.goals.snapshot("123"), {});
  tx.commit();
  const preview = f.goals.transaction("123", true);
  await render("${resetgoal community}", { goals: preview });
  preview.commit();
  const update = f.goals.transaction("123");
  update.create({ name: "community", tracking: "bits", target: 2000 });
  f.goals.receive("123", "channel.cheer", { bits: 500 }, { message_id: "during-command" });
  update.commit();
  assert.equal(f.goals.snapshot("123").community.current, 500);
  const reset = f.goals.transaction("123");
  reset.reset("community");
  reset.commit();
  f.goals.receive("123", "channel.cheer", { bits: 500 }, { message_id: "during-command" });
  assert.equal(f.goals.snapshot("123").community.current, 0);
  assert.equal(f.goals.snapshot("123").community.target, 2000);
});
test("native creator-goal variants follow their type and accept decreases without replaying stale snapshots", (t) => {
  const f = fixture(t);
  f.add("native", "creator-subscription-count", 100);
  f.goals.receive(
    "123",
    "channel.goal.progress",
    { id: "goal", type: "subscription_count", current_amount: 50 },
    { message_id: "one" },
  );
  f.advance(10);
  f.goals.receive(
    "123",
    "channel.goal.progress",
    { id: "goal", type: "subscription_count", current_amount: 49 },
    { message_id: "two" },
  );
  f.goals.update("123", {
    creatorGoals: {
      requestedAt: 100000,
      goals: [{ id: "goal", type: "subscription_count", current_amount: 50 }],
    },
  });
  assert.equal(f.goals.snapshot("123").native.current, 49);
  f.advance(10);
  f.goals.update("123", {
    creatorGoals: {
      requestedAt: 100020,
      goals: [{ id: "goal", type: "subscription_count", current_amount: 50 }],
    },
  });
  assert.equal(f.goals.snapshot("123").native.current, 50);
  f.goals.receive(
    "123",
    "channel.goal.progress",
    { id: "other", type: "follow", current_amount: 500 },
    { message_id: "three" },
  );
  assert.equal(f.goals.snapshot("123").native.current, 50);
});
test("unreadable goal storage is isolated and preserved instead of breaking Core or being overwritten", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-goal-corrupt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "overlays"));
  const filename = path.join(root, "overlays", "goals.json");
  fs.writeFileSync(filename, "broken");
  const goals = make({ runtimeDir: root });
  assert.match(goals.error(), /preserved/);
  assert.throws(() => goals.transaction("123"), /preserved/);
  goals.receive("123", "channel.cheer", { bits: 500 });
  assert.equal(fs.readFileSync(filename, "utf8"), "broken");
});
test("a stale overlay save cannot create or change its named goals", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-goal-revision-"));
  const service = require("../src/domains/overlays/stream-overlays.service")({
    runtimeDir: dir,
    getProvider: () => ({ status: () => ({ connected: true, userId: "123", scopes: [] }) }),
  });
  t.after(() => {
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  service.save({ expectedRevision: 0, document: { widgets: [] } });
  assert.throws(
    () =>
      service.save({
        expectedRevision: 0,
        document: {
          widgets: [
            {
              type: "goal",
              id: "goal",
              goalSource: "events",
              goalName: "bits",
              goalTracking: "bits",
              target: 100,
            },
          ],
        },
      }),
    /another window/,
  );
  assert.deepEqual(service.goals.snapshot("123"), {});
});
test("native goal readers use scoped GET endpoints and publish only campaign/goal presentation values", async () => {
  const calls = [];
  const api = require("../src/capabilities/feature-platform/providers/twitch-overlay-api")({
    base: "https://api.twitch.tv/helix",
    text: (s, n) => String(s || "").slice(0, n),
    request: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        body: {
          data: [
            {
              id: "native",
              type: "new_bit",
              current_amount: 250,
              target_amount: 1000,
              broadcaster_id: "private",
              donations: [{ user_id: "private" }],
            },
          ],
        },
      };
    },
  });
  const credentials = { clientId: "client", userId: "123", accessToken: "secret" };
  const result = await api.overlayCreatorGoals({ credentials });
  assert.equal(result.goals[0].current_amount, 250);
  await api.overlayCharity({ credentials });
  assert.match(calls[0].url, /\/goals\?broadcaster_id=123$/);
  assert.match(calls[1].url, /\/charity\/campaigns\?broadcaster_id=123$/);
  assert.ok(calls.every((row) => row.init.method === undefined));
  assert.doesNotMatch(JSON.stringify(result), /private|secret|broadcaster_id/);
});
test("updating a goal preserves its deadline and changing to a numeric source removes money formatting", (t) => {
  const f = fixture(t);
  f.add("community", "donations", 100, { currency: "EUR", endsAt: 200000 });
  f.add("community", "donations", 200);
  assert.equal(f.goals.snapshot("123").community.endsAt, 200000);
  f.add("community", "bits", 1000);
  assert.equal(f.goals.snapshot("123").community.currency, "");
  assert.throws(() => f.add("invalid", "bits", 100, { endsAt: Infinity }), /end time/);
  assert.throws(() => f.goals.transaction("123").reset("constructor"), /No goal/);
  f.add("constructor", "bits", 100);
  assert.equal(f.goals.snapshot("123").constructor.target, 100);
});
