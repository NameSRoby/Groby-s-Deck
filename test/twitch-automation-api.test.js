const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createTwitchApiClient,
} = require("../src/capabilities/feature-platform/providers/twitch-api-client");
const credentials = {
  userId: "123",
  clientId: "fixture-client",
  accessToken: "fixture-private-access",
};
const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});
test("reward creation/update map all editable options; disabling limits and viewer text remain explicit", async () => {
  const calls = [],
    api = createTwitchApiClient({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return response(200, { data: [{ id: "reward", title: "Custom", cost: 250 }] });
      },
    });
  await api.createReward({
    credentials,
    title: "Custom",
    cost: 250,
    userInputRequired: false,
    maxPerStream: 10,
    maxPerUser: 2,
    cooldownSeconds: 60,
    backgroundColor: "#123456",
  });
  let body = JSON.parse(calls[0].init.body);
  assert.equal(body.is_user_input_required, false);
  assert.equal(body.max_per_user_per_stream, 2);
  assert.equal(body.global_cooldown_seconds, 60);
  assert.equal(body.should_redemptions_skip_request_queue, false);
  await api.updateReward({
    credentials,
    rewardId: "reward",
    title: "Edited",
    maxPerStream: 0,
    maxPerUser: 0,
    cooldownSeconds: 0,
    paused: true,
  });
  body = JSON.parse(calls[1].init.body);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(body.is_max_per_stream_enabled, false);
  assert.equal(body.is_max_per_user_per_stream_enabled, false);
  assert.equal(body.is_global_cooldown_enabled, false);
  assert.equal(body.is_paused, true);
  assert.equal("cost" in body, false);
  await api.deleteReward({ credentials, rewardId: "reward" });
  assert.equal(calls[2].init.method, "DELETE");
  assert.equal(new URL(calls[2].url).searchParams.get("broadcaster_id"), "123");
});
test("commercial and native shoutout use their Helix endpoints; cooldown failures are not retried", async () => {
  const calls = [];
  let status = 200;
  const api = createTwitchApiClient({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response(status, { data: [{ length: 30, retry_after: 480 }] });
    },
  });
  const commercial = await api.twitchAction({
    credentials,
    kind: "commercial",
    params: { length: 30 },
  });
  assert.equal(commercial.retryAfter, 480);
  assert.equal(JSON.parse(calls[0].init.body).broadcaster_id, "123");
  await api.twitchAction({
    credentials,
    kind: "shoutout",
    params: { target: "user-id", userId: "456" },
  });
  const shoutout = new URL(calls[1].url);
  assert.equal(shoutout.pathname, "/helix/chat/shoutouts");
  assert.equal(shoutout.searchParams.get("to_broadcaster_id"), "456");
  assert.equal(shoutout.searchParams.get("moderator_id"), "123");
  status = 429;
  assert.equal(
    (await api.twitchAction({ credentials, kind: "commercial", params: { length: 30 } })).error,
    "twitch_action_cooldown",
  );
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(commercial).includes("fixture-private-access"), false);
});
test("provider refuses edits to rewards created by another Twitch application", async () => {
  let manageable = false,
    writes = 0;
  const controls =
    require("../src/capabilities/feature-platform/providers/twitch-extended-controls")({
      api: {
        inspectReward: async () => ({ ok: true, exists: true, manageable }),
        updateReward: async () => {
          writes++;
          return { ok: true };
        },
      },
      withAuthorization: (fn) => fn(credentials),
      getProfile: () => ({ managedRewards: {} }),
      persist: () => {},
      clearCatalog: () => {},
    });
  assert.equal(
    (await controls.updateReward({ rewardId: "other", cost: 200 })).error,
    "twitch_reward_not_manageable",
  );
  assert.equal(writes, 0);
  manageable = true;
  assert.equal((await controls.updateReward({ rewardId: "ours", cost: 200 })).ok, true);
  assert.equal(writes, 1);
});
test("EventSub automation subscriptions use correct versions, scopes, conditions and event delivery", async (t) => {
  let clock = 1000,
    monitor;
  const delivered = [],
    granted = ["channel:read:subscriptions", "channel:read:hype_train", "channel:read:polls"];
  const provider = require("../src/capabilities/feature-platform/providers/twitch-oauth-provider")({
    defaultClientId: "fixtureclient123",
    now: () => clock,
    getAutomationEvents: () => [
      "channel.raid",
      "channel.subscribe",
      "channel.cheer",
      "stream.online",
      "channel.hype_train.begin",
      "channel.poll.end",
    ],
    onEvent: (...args) => delivered.push(args),
    eventSubMonitorFactory: (options) => {
      monitor = options;
      return { start() {}, stop() {}, restart() {}, snapshot: () => ({ connected: true }) };
    },
    api: {
      beginDeviceAuthorization: async () => ({
        ok: true,
        deviceCode: "fixture-device",
        userCode: "CODE",
        interval: 1,
        expiresIn: 600,
      }),
      pollDeviceAuthorization: async () => ({
        ok: true,
        accessToken: "fixture-private-access",
        refreshToken: "fixture-private-refresh",
        expiresIn: 3600,
      }),
      validateToken: async () => ({
        ok: true,
        clientId: "fixtureclient123",
        userId: "123",
        login: "fixture",
        scopes: granted,
        expiresIn: 3600,
      }),
    },
  });
  t.after(() => provider.shutdown());
  await provider.begin({ permissionGroups: ["subscribers", "hype-train", "polls"] });
  clock += 1000;
  await provider.poll();
  const definitions = monitor.getSubscriptionConfig().events;
  assert.equal(
    definitions.some((row) => row.type === "channel.cheer"),
    false,
  );
  assert.deepEqual(definitions.find((row) => row.type === "channel.raid").condition, {
    to_broadcaster_user_id: "123",
  });
  assert.equal(definitions.find((row) => row.type === "channel.hype_train.begin").version, "2");
  await monitor.onEvent(
    "channel.subscribe",
    { broadcaster_user_id: "123", user_login: "viewer" },
    { message_id: "sub-1" },
  );
  assert.equal(delivered[0][0], "channel.subscribe");
  await monitor.onEvent("channel.cheer", { broadcaster_user_id: "123" }, { message_id: "bits-1" });
  assert.equal(delivered.length, 1, "missing scopes cannot deliver that event");
});

test("generated chat outputs cannot retrigger automations before or after Helix acknowledgement", async () => {
  let complete;
  const filter = require("../src/capabilities/feature-platform/providers/twitch-outgoing-chat")(
      () => 1000,
    ),
    sending = filter.send(
      "123",
      { message: "!starttimer" },
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  const event = {
    broadcaster_user_id: "123",
    chatter_user_id: "123",
    message_id: "our-message",
    message: { text: "!starttimer" },
  };
  const incoming = filter.owns(event);
  complete({ ok: true, messageId: "our-message" });
  await sending;
  assert.equal(await incoming, true);
  assert.equal(await filter.owns(event), true);
  assert.equal(
    await filter.owns({ ...event, message_id: "manual-new" }),
    false,
    "a separate broadcaster command still works",
  );
  assert.equal(
    await filter.owns({ ...event, chatter_user_id: "456" }),
    false,
    "viewer messages are not mistaken for the app",
  );
});
