const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const policy = require("../src/domains/twitch/live-reward-policy");
test("live rewards pause offline, resume online and preserve manual pauses across restarts", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-live-rewards-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let live = false,
    fail = false;
  const rewards = [
      { id: "ad", manageable: true, paused: false },
      { id: "manual", manageable: true, paused: true },
      { id: "chat", manageable: true, paused: false },
    ],
    writes = [];
  const rows = rewards.map((row) => ({
    trigger: { type: "reward", rewardId: row.id },
    handler: "flow",
    steps: [{ type: "if", then: [{ actionId: row.id === "chat" ? "chat" : "ad" }], else: [] }],
  }));
  const provider = {
    status: () => ({ userId: "fixture", connected: true }),
    dashboardStream: async () => ({ ok: !fail, live }),
    listRewards: async () => ({ ok: true, rewards: structuredClone(rewards) }),
    updateReward: async (input) => {
      writes.push(input);
      rewards.find((row) => row.id === input.rewardId).paused = input.paused;
      return { ok: true };
    },
  };
  const options = {
    file: path.join(dir, "policy.json"),
    getProvider: () => provider,
    getRows: () => rows,
    getCatalog: () => [{ id: "ad", requiresLive: true }, { id: "chat" }],
  };
  let service = policy(options);
  service.setActive(true);
  await service.sync(true);
  assert.equal(rewards[0].paused, true);
  assert.equal(rewards[2].paused, false);
  assert.deepEqual(service.pausedIds(), ["ad"]);
  await service.sync(true);
  assert.equal(writes.length, 1);
  service.setActive(false);
  service = policy(options);
  service.setActive(true);
  live = true;
  await service.sync(true);
  assert.equal(rewards[0].paused, false);
  assert.equal(rewards[1].paused, true);
  fail = true;
  live = false;
  await service.sync(true);
  assert.equal(rewards[0].paused, false, "unknown stream state must not change Twitch");
  fail = false;
  await service.sync(true);
  service.edited("ad", true);
  live = true;
  await service.sync(true);
  assert.equal(rewards[0].paused, true, "explicit manual pause survives going live");
});
