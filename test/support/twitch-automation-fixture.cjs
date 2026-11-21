/** Synthetic Twitch and microphone owners; no network or OS controls are used. */
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
module.exports = function fixture(t) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-twitch-flows-")),
    file = path.join(runtimeDir, "system", "twitch-automations.json"),
    calls = [],
    settlements = [],
    writes = [],
    mics = new Map([
      ["one", false],
      ["two", true],
    ]);
  let owner = "123";
  const rewards = [
    {
      id: "reward-one",
      title: "Switch microphones",
      cost: 100,
      prompt: "",
      enabled: true,
      paused: false,
      userInputRequired: false,
      manageable: true,
    },
  ];
  const managedRewards = [
    { purpose: "lights", rewardId: "reward-one", title: "Switch microphones", cost: 100 },
  ];
  const actions = {
    catalog: () =>
      [...mics]
        .map(([id, muted]) => ({
          id: "fixture.mic." + id,
          label: "Microphone " + id,
          group: "Studio",
          available: true,
          state: { muted },
          restorable: true,
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["muted"],
            properties: { muted: { type: "boolean" } },
          },
          defaults: { muted: id === "one" },
        }))
        .concat([
          {
            id: "fixture.fail",
            label: "Fail",
            group: "Fixture",
            available: true,
            parameters: { type: "object", additionalProperties: false, properties: {} },
            defaults: {},
          },
        ]),
    execute: async (id, params) => {
      calls.push({ id, params });
      if (id === "fixture.fail") return { ok: false, error: "fixture_failed" };
      mics.set(id.split(".").at(-1), params.muted);
      return { ok: true };
    },
    restorationTarget(id) {
      if (!id.startsWith("fixture.mic.")) return null;
      const key = id.split(".").at(-1);
      return {
        key,
        capture: async () => mics.get(key),
        restore: async (value) => {
          calls.push({ restore: key, value });
          mics.set(key, value);
        },
      };
    },
  };
  const deck = require("../../src/domains/control-deck/control-deck.service")({
    runtimeDir,
    actions,
  });
  const provider = {
    status: () => ({
      connected: true,
      userId: owner,
      managedRewards: structuredClone(managedRewards),
      scopes: ["channel:manage:redemptions", "user:read:chat", "user:write:chat"],
    }),
    bindReward: async (input) => {
      if (!rewards.some((row) => row.id === input.rewardId && row.manageable))
        return { ok: false, error: "twitch_reward_not_manageable" };
      if (!managedRewards.some((row) => row.rewardId === input.rewardId))
        managedRewards.push({ purpose: input.purpose, rewardId: input.rewardId, title: "Bound" });
      return { ok: true };
    },
    createReward: async (input) => {
      writes.push({ operation: "create", ...input });
      const id = "created-" + writes.length;
      rewards.push({ id, ...input, manageable: true });
      managedRewards.push({
        purpose: input.purpose,
        rewardId: id,
        title: input.title,
        cost: input.cost,
      });
      return { ok: true, rewardId: id };
    },
    updateReward: async (input) => {
      writes.push({ operation: "update", ...input });
      Object.assign(
        rewards.find((row) => row.id === input.rewardId),
        input,
      );
      return { ok: true, rewardId: input.rewardId };
    },
    deleteReward: async (input) => {
      writes.push({ operation: "delete", ...input });
      rewards.splice(
        rewards.findIndex((row) => row.id === input.rewardId),
        1,
      );
      for (let i = managedRewards.length - 1; i >= 0; i--)
        if (managedRewards[i].rewardId === input.rewardId) managedRewards.splice(i, 1);
      return { ok: true, rewardId: input.rewardId };
    },
    settle: async (input) => {
      settlements.push(input);
      return { ok: true, status: input.status };
    },
    runAction: async (input) => {
      calls.push({ twitch: input });
      return { ok: true };
    },
  };
  const options = {
    file,
    getProvider: () => provider,
    deck,
    legacy: async (event, mapping) => {
      calls.push({ legacy: mapping });
      return { body: { ok: true } };
    },
  };
  const automations = require("../../src/domains/twitch/twitch-automations.service")(options);
  let queueClock = null;
  provider.dashboardStream = async () => ({ ok: true, live: true });
  const twitchActions = require("../../src/domains/twitch/twitch-flow-actions")({
      getProvider: () => provider,
      getAutomations: () => automations,
      now: () => queueClock ?? Date.now(),
    }),
    baseCatalog = actions.catalog,
    baseExecute = actions.execute;
  actions.catalog = () => [...baseCatalog(), ...twitchActions.catalog()];
  actions.execute = (id, params, signal) =>
    id.startsWith("twitch.")
      ? twitchActions.execute(id, params, signal)
      : baseExecute(id, params, signal);
  t.after(async () => {
    twitchActions.shutdown();
    automations.shutdown();
    await deck.shutdown();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  return {
    twitchActions,
    advanceQueue(ms) {
      queueClock = (queueClock ?? Date.now()) + ms;
    },
    runtimeDir,
    file,
    actions,
    deck,
    provider,
    rewards,
    managedRewards,
    automations,
    calls,
    settlements,
    writes,
    mics,
    options,
    setOwner: (value) => {
      owner = value;
    },
  };
};
module.exports.flow = (
  id = "a".repeat(24),
  trigger = { type: "reward", rewardId: "reward-one" },
) => ({
  id,
  name: "Studio switch",
  enabled: true,
  trigger,
  handler: "flow",
  role: "viewer",
  cooldownSeconds: 30,
  steps: [
    { type: "remember" },
    {
      type: "parallel",
      steps: [
        { actionId: "fixture.mic.one", params: { muted: true } },
        { actionId: "fixture.mic.two", params: { muted: false } },
      ],
    },
    { actionId: "deck.wait", params: { durationMs: 20 } },
    { type: "restore" },
  ],
});
module.exports.until = async (fn) => {
  const end = Date.now() + 4000;
  while (!fn()) {
    if (Date.now() > end) throw Error("Fixture did not settle");
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
};
