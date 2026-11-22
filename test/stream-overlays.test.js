const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const model = require("../public/core/overlay-model"),
  createService = require("../src/domains/overlays/stream-overlays.service");

test("credit history survives restart, isolates accounts and caches supporter pages without an idle timer", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-credits-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const make = require("../src/domains/overlays/overlay-credits");
  let time = 100000,
    calls = 0;
  const credits = make(root, () => time);
  credits.reset("123");
  credits.receive("channel.subscribe", { user_name: "Alice" });
  credits.receive("channel.subscribe", { user_name: "Alice" });
  const status = {
    scopes: ["channel:read:subscriptions"],
    provider: {
      overlaySupporters: async () => {
        calls++;
        return { ok: true, names: [{ name: "Alice", at: null }], truncated: false };
      },
    },
  };
  const widgets = [{ type: "credits", visible: true, creditsSource: "subscribers" }];
  assert.equal((await credits.data(status, widgets)).history.length, 1);
  await credits.data(status, widgets);
  assert.equal(calls, 1);
  const restarted = make(root, () => time);
  restarted.reset("123");
  assert.equal((await restarted.data(status, widgets)).history[0].name, "Alice");
  time += 900001;
  await credits.data(status, widgets);
  assert.equal(calls, 3);
  credits.reset("456");
  assert.equal((await credits.data(status, [])).history.length, 0);
  const noAccess = await credits.data({ ...status, scopes: [] }, widgets);
  assert.deepEqual(noAccess.subscribers, { ok: false, names: [] });
});
function fixture(t) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-overlay-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  let time = 100000,
    account = "123",
    connected = true;
  const calls = [];
  const provider = {
    status: () => ({
      connected,
      userId: account,
      scopes: ["moderator:read:followers", "channel:read:subscriptions", "user:read:chat"],
    }),
    refreshSubscriptions() {},
    dashboardStream: async () => {
      calls.push("stream");
      return { ok: true, live: true, title: "Sample stream", viewers: 5 };
    },
    dashboardFollowers: async () => {
      calls.push("followers");
      return { ok: true, total: 9, recent: [{ name: "SampleViewer" }] };
    },
    dashboardSubscribers: async () => {
      calls.push("subscribers");
      return { ok: true, total: 4, points: 6 };
    },
  };
  const registry = {
    list: () => ({ features: [{ id: "song-request", lifecycle: "active" }] }),
    request: async (_id, cap) => {
      calls.push(cap);
      return {
        ok: true,
        value:
          cap === "song.queue.read.v1"
            ? { queue: [], counts: { queued: 0 } }
            : { primary: { candidate: { title: "Sample song", artists: ["Sample artist"] } } },
      };
    },
  };
  const service = createService({
    runtimeDir,
    getProvider: () => provider,
    getRegistry: () => registry,
    now: () => time,
  });
  t.after(() => service.close());
  const save = (types) =>
    service.save({
      expectedRevision: service.store.snapshot().revision,
      document: { widgets: types.map((type, index) => ({ id: "widget-" + index, type })) },
    });
  return {
    service,
    save,
    calls,
    runtimeDir,
    account(value) {
      account = value;
    },
    disconnect() {
      connected = false;
    },
    advance(ms) {
      time += ms;
    },
  };
}

test("unsaved editor interests fetch live sources without saving, expire and release subscriptions", async (t) => {
  const f = fixture(t),
    id = "12345678-1234-1234-1234-123456789abc";
  const widgets = ["title", "followers", "chat", "poll"].map((type) => ({ type, id: type }));
  let data = await f.service.preview({ clientId: id, widgets });
  assert.equal(data.twitch.stream.title, "Sample stream");
  assert.equal(data.twitch.followers.total, 9);
  assert.equal(f.service.store.snapshot().documents.length, 0);
  assert.ok(f.service.events().includes("channel.chat.message"));
  assert.ok(f.service.events().includes("channel.poll.progress"));
  f.service.receive(
    "channel.chat.message",
    {
      message_id: "bot",
      chatter_user_name: "Broadcaster",
      chatter_user_login: "broadcaster",
      message: { text: "Reply" },
    },
    { isAppMessage: true },
  );
  f.service.receive("channel.chat.message", {
    message_id: "human",
    chatter_user_name: "Broadcaster",
    chatter_user_login: "broadcaster",
    message: { text: "Typed manually" },
  });
  data = await f.service.data();
  assert.deepEqual(
    data.events.map((row) => [row.login, row.isAppMessage]),
    [
      ["broadcaster", true],
      ["broadcaster", false],
    ],
  );
  f.advance(15001);
  assert.deepEqual(f.service.events(), []);
  await f.service.preview({ clientId: id, widgets });
  f.service.endPreview(id);
  assert.deepEqual(f.service.events(), []);
  assert.throws(() => f.service.preview({ clientId: "bad", widgets }), /session/);
});

test("editor interests are bounded, renewed without duplicate notifications, and released on close", () => {
  let time = 1000,
    changes = 0;
  const sessions = require("../src/domains/overlays/overlay-preview-sessions")({
    now: () => time,
    changed: () => changes++,
  });
  try {
    const id = (i) => "12345678-1234-1234-1234-" + String(i).padStart(12, "0");
    const widgets = [{ type: "chat", visible: true }];
    sessions.set(id(0), widgets);
    sessions.set(id(0), widgets);
    assert.equal(changes, 1);
    for (let i = 1; i < 8; i++) sessions.set(id(i), widgets);
    assert.throws(() => sessions.set(id(8), widgets), /unused overlay editor/);
    assert.equal(sessions.widgets().length, 8);
    time += 15001;
    assert.equal(sessions.widgets().length, 0);
    sessions.set(id(8), widgets);
    assert.equal(sessions.widgets().length, 1);
  } finally {
    sessions.close();
  }
  assert.equal(sessions.widgets().length, 0);
});
test("overlay documents default to 1080p, validate layers, persist and reject stale overwrites", (t) => {
  const f = fixture(t);
  assert.equal(model.document().width, 1920);
  assert.equal(model.document().height, 1080);
  assert.throws(() => model.document({ widgets: [{ id: "bad", type: "charity" }] }), /Unsupported/);
  assert.equal(model.mediaUrl("javascript:alert(1)"), "");
  assert.equal(model.mediaUrl("file:///private"), "");
  const saved = f.save(["text", "clock"]),
    id = saved.selectedId;
  assert.ok(id);
  assert.equal(saved.documents[0].widgets.length, 2);
  assert.throws(
    () => f.service.save({ expectedRevision: 0, document: saved.documents[0] }),
    /another window/,
  );
  const loaded = createService({ runtimeDir: f.runtimeDir }).store.get(id);
  assert.deepEqual(loaded, saved.documents[0]);
  const smaller = model.document({ ...loaded, width: 100, height: 100 });
  assert.ok(smaller.widgets.every((w) => w.width <= 100 && w.x + w.width <= 100));
});
test("widget catalog exposes actual sources and one lazy cache serves concurrent readers", async (t) => {
  const f = fixture(t);
  assert.equal(f.calls.length, 0);
  assert.ok(!f.service.catalog().some((row) => /charity|tip|merch|giveaway/i.test(row.name)));
  const coreOnly = createService({ runtimeDir: f.runtimeDir });
  assert.ok(
    coreOnly.catalog().every((row) => ["Static", "Custom", "Tools", "Games"].includes(row.group)),
  );
  f.save(["title", "followers", "subscribers", "now-playing"]);
  const rows = await Promise.all(Array.from({ length: 20 }, () => f.service.data()));
  assert.equal(rows[0].music.current.title, "Sample song");
  assert.deepEqual(
    f.calls.sort(),
    ["followers", "song.playback.read.v1", "song.queue.read.v1", "stream", "subscribers"].sort(),
  );
  await f.service.data();
  assert.equal(f.calls.length, 5);
  f.advance(30001);
  await f.service.data();
  assert.equal(f.calls.length, 10);
  f.disconnect();
  const offline = await f.service.data();
  assert.deepEqual(offline.twitch, {});
  assert.equal(offline.connected, false);
});
test("events are bounded, deduplicated, moderated and reset when the connected broadcaster changes", async (t) => {
  const f = fixture(t);
  f.save(["chat", "poll", "alerts"]);
  assert.ok(f.service.events().includes("channel.chat.clear_user_messages"));
  f.service.receive("channel.chat.message", {
    message_id: "one",
    chatter_user_id: "viewer",
    chatter_user_name: "Sample",
    message: { text: "Hello" },
  });
  f.service.receive("channel.chat.message", { message_id: "one", message: { text: "Duplicate" } });
  assert.equal((await f.service.data()).events.length, 1);
  f.service.receive("channel.chat.message_delete", { message_id: "one" });
  assert.equal((await f.service.data()).events.length, 0);
  for (let i = 0; i < 150; i++)
    f.service.receive("channel.chat.message", {
      message_id: "m" + i,
      chatter_user_id: "viewer",
      message: { text: "Hello" },
    });
  assert.equal((await f.service.data()).events.length, 100);
  f.service.receive("channel.chat.clear_user_messages", { target_user_id: "viewer" });
  assert.equal((await f.service.data()).events.length, 0);
  f.service.receive(
    "channel.follow",
    { user_name: "Old account follower" },
    { message_id: "follow" },
  );
  f.account("456");
  assert.equal((await f.service.data()).events.length, 0);
});
test("moderation wins against delayed echoes without suppressing later messages", (t) => {
  const f = fixture(t);
  const send = (id, user, chatOrder) =>
    f.service.receive(
      "channel.chat.message",
      {
        message_id: id,
        chatter_user_id: user,
        message: { text: id },
      },
      { chatOrder },
    );
  f.service.receive("channel.chat.message_delete", { message_id: "deleted" }, { chatOrder: 3 });
  send("deleted", "sender", 2);
  f.service.receive(
    "channel.chat.clear_user_messages",
    { target_user_id: "sender" },
    { chatOrder: 5 },
  );
  send("late from sender", "sender", 4);
  send("other chatter", "other", 4);
  send("later from sender", "sender", 6);
  f.service.receive("channel.chat.clear", {}, { chatOrder: 7 });
  send("late from room", "other", 6);
  send("new message", "sender", 8);
  return f.service.data().then(({ events }) =>
    assert.deepEqual(
      events.map((row) => row.id),
      ["new message"],
    ),
  );
});
test("media uploads enforce format, size and path boundaries", (t) => {
  const f = fixture(t),
    media = require("../src/domains/overlays/overlay-media")(f.runtimeDir);
  assert.throws(() => media.add("image/png", Buffer.from("not a real image")), /valid/);
  const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
      "base64",
    ),
    asset = media.add("image/png", png);
  assert.ok(media.locate(asset.url.split("/").pop()));
  assert.equal(media.locate("../../private.json"), null);
  assert.equal(model.mediaUrl(asset.url), asset.url);
});
