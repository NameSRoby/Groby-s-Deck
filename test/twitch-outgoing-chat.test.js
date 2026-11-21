const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  create = require("../src/capabilities/feature-platform/providers/twitch-outgoing-chat");
const event = (id, text = "!loop", sender = "123", channel = "123") => ({
  broadcaster_user_id: channel,
  chatter_user_id: sender,
  message_id: id,
  message: { text },
});
const directory = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-echo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "outgoing.json");
};

test("early API echoes wait for acknowledgement; identical human commands remain eligible", async () => {
  const guard = create();
  let complete;
  const sending = guard.send(
    "123",
    { message: "!loop" },
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  let settled = false;
  const own = guard.owns(event("own")).then((value) => {
      settled = true;
      return value;
    }),
    manual = guard.owns(event("human"));
  await new Promise(setImmediate);
  assert.equal(settled, false, "no command can run before the send is classified");
  complete({ ok: true, messageId: "own" });
  await sending;
  assert.equal(await own, true);
  assert.equal(await manual, false);
  assert.equal(
    await guard.owns(event("own", "edited text")),
    true,
    "IDs, not output text, identify acknowledged sends",
  );
  assert.equal(await guard.owns(event("human")), false);
});

test("confirmed outputs stay excluded after delays, restarts and shared-chat ID remapping", async (t) => {
  const file = directory(t);
  let clock = 1000;
  const first = create(() => clock, { file });
  await first.send("123", { message: "!loop" }, async () => ({ ok: true, messageId: "original" }));
  clock += 86400000;
  const restarted = create(() => clock, { file });
  assert.equal(await restarted.owns(event("original")), true);
  assert.equal(
    await restarted.owns({
      ...event("shared-copy", "!loop", "123", "456"),
      source_broadcaster_user_id: "123",
      source_message_id: "original",
    }),
    true,
  );
  assert.equal(await restarted.owns(event("original", "!loop", "other")), false);
  assert.equal(await restarted.owns(event("original", "!loop", "123", "other")), false);
  assert.equal(await restarted.owns(event("manual")), false);
  const saved = fs.readFileSync(file, "utf8");
  assert.equal(saved.includes("!loop"), false, "chat text stays out of the private journal");
  assert.ok(Buffer.byteLength(saved) < 2000000);
});

test("ambiguous sends and announcements are claimed once, while rejected sends do not swallow commands", async (t) => {
  const file = directory(t),
    guard = create(() => 1000, { file });
  await assert.rejects(
    guard.send("123", { message: "!loop" }, async () => {
      throw Error("network lost");
    }),
  );
  const restored = create(() => 1000, { file });
  assert.equal(await restored.owns(event("uncertain")), true);
  assert.equal(await restored.owns(event("uncertain")), true);
  assert.equal(await restored.owns(event("human")), false);
  await restored.send("123", { message: "!announce" }, async () => ({ ok: true }));
  assert.equal(await restored.owns(event("announcement", "!announce")), true);
  assert.equal(await restored.owns(event("manual-announcement-copy", "!announce")), false);
  await restored.send("123", { message: "!drop" }, async () => ({
    ok: false,
    error: "twitch_chat_dropped",
  }));
  assert.equal(await restored.owns(event("manual-drop", "!drop")), false);
});

test("capacity and unavailable storage fail before dispatch; ordinary pending sends retain their protection", async (t) => {
  const guard = create(),
    releases = [],
    sends = [];
  for (let i = 0; i < 128; i++)
    sends.push(
      guard.send(
        "123",
        { message: "!loop" },
        () =>
          new Promise((resolve) =>
            releases.push(() => resolve({ ok: true, messageId: "id-" + i })),
          ),
      ),
    );
  let extra = 0;
  assert.equal((await guard.send("123", { message: "!loop" }, () => extra++)).ok, false);
  assert.equal(extra, 0);
  releases.forEach((release) => release());
  await Promise.all(sends);
  assert.equal(await guard.owns(event("id-0")), true);
  const file = directory(t);
  fs.writeFileSync(file, "invalid");
  const blocked = create(Date.now, { file });
  assert.equal((await blocked.send("123", { message: "!loop" }, () => extra++)).ok, false);
  assert.equal(extra, 0);
  guard.close();
  assert.equal((await guard.send("123", { message: "!loop" }, () => extra++)).ok, false);
});

test("provider guards every message route before any chat consumer and allows manual broadcaster commands", async (t) => {
  let clock = 1000,
    monitor,
    nextId = 0,
    release,
    echoReplies = false;
  const received = [],
    presentations = [],
    writes = [],
    echoes = [];
  const provider = require("../src/capabilities/feature-platform/providers/twitch-oauth-provider")({
    defaultClientId: "fixtureclient123",
    now: () => clock,
    onChatPresentation: (incoming, metadata) =>
      presentations.push({ id: incoming.message_id, bot: metadata.isAppMessage }),
    onChat: (incoming) => {
      received.push(incoming.message_id);
      if (echoReplies) {
        assert.equal(
          incoming.message_id,
          "manual-loop",
          "an output must not activate the replying command",
        );
        return provider.sendChat({ message: incoming.message.text });
      }
    },
    eventSubMonitorFactory: (options) => {
      monitor = options;
      return { start() {}, stop() {}, restart() {} };
    },
    api: {
      beginDeviceAuthorization: async () => ({
        ok: true,
        deviceCode: "fixture",
        userCode: "CODE",
        interval: 1,
        expiresIn: 600,
      }),
      pollDeviceAuthorization: async () => ({
        ok: true,
        accessToken: "fixture-private-access",
        refreshToken: "fixture-private-refresh",
        expiresIn: 14400,
      }),
      validateToken: async () => ({
        ok: true,
        clientId: "fixtureclient123",
        userId: "123",
        login: "fixture",
        scopes: ["user:read:chat", "user:write:chat", "moderator:manage:announcements"],
        expiresIn: 14400,
      }),
      sendChat: async (input) => {
        writes.push(input.message);
        const id = "sent-" + ++nextId;
        if (input.message === "!early")
          await new Promise((resolve) => {
            release = resolve;
          });
        if (echoReplies)
          echoes.push(Promise.resolve().then(() => monitor.onChat(event(id, input.message))));
        return { ok: true, messageId: id };
      },
      twitchAction: async (input) => {
        writes.push(input.params.message);
        return { ok: true, kind: input.kind };
      },
    },
  });
  t.after(() => provider.shutdown());
  await provider.begin({ permissionGroups: ["chat-read", "chat-send", "announcements"] });
  clock += 1000;
  await provider.poll();
  await provider.sendChat({ message: "!loop" });
  await monitor.onChat(event("sent-1"));
  await provider.runAction({ kind: "chat", params: { message: "exact phrase" } });
  await monitor.onChat(event("sent-2", "exact phrase"));
  await provider.runAction({
    kind: "announcement",
    params: { message: "!loop", color: "primary" },
  });
  await monitor.onChat(event("announce-echo"));
  assert.deepEqual(
    received,
    [],
    "automation, built-in and clip consumers never receive our outputs",
  );
  clock += 60000;
  await monitor.onChat(event("sent-1"));
  await monitor.onChat(event("manual-broadcaster"));
  await monitor.onChat(event("viewer", "!loop", "456"));
  assert.deepEqual(received, ["manual-broadcaster", "viewer"]);
  const sending = provider.sendChat({ message: "!early" });
  while (!release) await new Promise(setImmediate);
  const own = monitor.onChat(event("sent-3", "!early")),
    human = monitor.onChat(event("manual-early", "!early"));
  release();
  await Promise.all([sending, own, human]);
  assert.deepEqual(received, ["manual-broadcaster", "viewer", "manual-early"]);
  assert.deepEqual(writes, ["!loop", "exact phrase", "!loop", "!early"]);
  echoReplies = true;
  await monitor.onChat(event("manual-loop"));
  await Promise.all(echoes);
  assert.equal(writes.length, 5, "one human command produces exactly one reply");
  assert.equal(received.at(-1), "manual-loop");
  assert.ok(presentations.some((row) => row.id === "sent-1" && row.bot));
  assert.ok(presentations.some((row) => row.id === "manual-broadcaster" && !row.bot));
  assert.ok(presentations.some((row) => row.id === "viewer" && !row.bot));
});
