const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-watchtime-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "community.json"),
    store = require("../src/domains/twitch/community-store")(file),
    followers = new Set(["follower", "subscriber"]),
    subscribers = new Set(["2"]),
    calls = [];
  let now = Date.UTC(2026, 0, 1);
  const provider = {
    status: () => ({ userId: "123", scopes: ["channel:read:subscriptions"] }),
    followAge: async ({ login }) => {
      calls.push(login);
      return { ok: true, followedAt: followers.has(login) ? "2025-01-01" : null };
    },
    subscriberStatus: async ({ userIds }) => ({
      ok: true,
      ids: userIds.filter((id) => subscribers.has(id)),
    }),
  };
  const policy = require("../src/domains/twitch/watchtime-policy")({
    store,
    getProvider: () => provider,
    now: () => now,
  });
  const users = [
    { id: "1", login: "follower" },
    { id: "2", login: "subscriber" },
    { id: "3", login: "stranger" },
  ];
  return {
    policy,
    store,
    file,
    followers,
    subscribers,
    users,
    calls,
    advance: (ms) => (now += ms),
    setNow: (value) => (now = value),
  };
}
test("only verified followers create records, negative results remain memory-only, and confirmed unfollows erase records", async (t) => {
  const f = fixture(t);
  assert.deepEqual([...(await f.policy.sample(f.users))], ["follower", "subscriber"]);
  assert.equal(f.store.peek("123", "stranger"), null);
  assert.doesNotMatch(fs.readFileSync(f.file, "utf8"), /stranger/);
  const count = f.calls.length;
  await f.policy.sample(f.users);
  assert.equal(f.calls.length, count);
  f.followers.delete("follower");
  f.advance(1800001);
  await f.policy.sample(f.users);
  assert.equal(f.store.peek("123", "follower"), null);
});
test("past-subscriber mode remembers verified history after expiry and never promotes a raid into a size heuristic", async (t) => {
  const f = fixture(t);
  f.policy.settings({ mode: "subscribed-followers" });
  assert.deepEqual([...(await f.policy.sample(f.users))], ["subscriber"]);
  assert.equal(f.store.peek("123", "follower"), null);
  f.subscribers.clear();
  f.advance(1800001);
  assert.deepEqual([...(await f.policy.sample(f.users))], ["subscriber"]);
  assert.equal(f.policy.settings().mode, "subscribed-followers");
});
test("inactive history survives years below the storage cap and keeps unrelated quotes", async (t) => {
  const f = fixture(t);
  await f.policy.sample(f.users);
  f.store.credit("123", "follower", 10);
  f.store.quote("123", "add", "A retained quote", "author", 0);
  f.setNow(Date.UTC(2036, 7, 1));
  f.policy.maintenance();
  assert.equal(f.store.peek("123", "follower").minutes, 10);
  assert.equal(f.store.peek("123", "subscriber").everSubscribed, true);
  assert.equal(f.policy.settings().storage.limitBytes, 8 * 1024 ** 3);
  assert.equal(f.store.account("123").quotes.length, 1);
});
test("large unknown audiences use a fixed verification budget and never persist unverified people", async (t) => {
  const f = fixture(t);
  const users = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i + 10),
    login: "person" + i,
  }));
  assert.equal((await f.policy.sample(users)).size, 0);
  assert.equal(f.calls.length, 200);
  assert.equal(f.store.count("123"), 0);
});

test("capacity eviction removes oldest users across accounts, preserves current users and quotes, and migration survives restart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-history-cap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "community.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      accounts: {
        123: {
          viewers: { legacy: { minutes: 400, points: 40, lastActiveAt: 1 } },
          quotes: [{ text: "Protected quote" }],
          imports: [],
        },
      },
    }),
  );
  let store = require("../src/domains/twitch/community-store")(file, { limitBytes: 131072 });
  assert.equal(store.peek("123", "legacy").minutes, 400);
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file)).accounts["123"].viewers, undefined);
  for (let i = 0; i < 600; i++) {
    store.touch(i < 300 ? "123" : "456", "user" + i, 100 + i, true);
    store.credit(i < 300 ? "123" : "456", "user" + i, 10);
  }
  store.flush();
  assert.equal(store.peek("123", "legacy"), null);
  assert.equal(store.peek("123", "user0"), null);
  assert.equal(store.peek("456", "user599").minutes, 10);
  assert.ok(store.count("123") + store.count("456") < 600);
  assert.ok(store.storageBudget().usedBytes <= 131072);
  assert.equal(store.account("123").quotes[0].text, "Protected quote");
  store = require("../src/domains/twitch/community-store")(file, { limitBytes: 131072 });
  assert.equal(store.peek("456", "user599").minutes, 10);
  assert.equal(store.peek("123", "legacy"), null);
});
