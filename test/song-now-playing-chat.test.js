const test = require("node:test"),
  assert = require("node:assert/strict");
const create = require("../features/song-request/dist/now-playing-chat");
const { composeChatResponse } = require("../features/song-request/dist/chat-responses");
const { createFeatureRuntimeHarness } = require("./support/feature-runtime-harness");

function fixture(player = "tidal") {
  const storage = new Map(),
    messages = [];
  let enabled = true,
    current = null,
    storageAvailable = true;
  const queue = {
    status: () => ({ responses: { now_playing: enabled } }),
    playbackStatus: () => ({ managed: current }),
  };
  const options = {
    queue,
    now: () => 100000,
    preferences: async () => ({ ok: true, player }),
    context: {
      callCapability: async (cap, method, payload) => {
        assert.equal(cap, "ravelink.storage.v1");
        if (!storageAvailable) return { ok: false };
        if (method === "set") storage.set(payload.key, structuredClone(payload.value));
        return { ok: true, value: storage.get(payload.key) };
      },
    },
    send: (request, result) =>
      messages.push(composeChatResponse(request, result, queue.status()).message),
  };
  return {
    storage,
    messages,
    options,
    create: () => create(options),
    enable: (value) => {
      enabled = value;
    },
    setManaged: (value) => {
      current = value;
    },
    storageAvailable: (value) => {
      storageAvailable = value;
    },
  };
}
const observation = (provider, title = "Personal song") => ({
  provider,
  sourceId: "native-session",
  available: true,
  status: "playing",
  title,
  artists: ["Artist"],
  observedAt: 100000,
});

for (const provider of ["tidal", "spotify", "soundcloud", "youtube"]) {
  test(`${provider}: ordinary songs announce once across polls, pauses and restart; track changes announce`, async () => {
    const f = fixture(provider);
    let chat = f.create();
    await chat.load();
    const song = observation(provider);
    await Promise.all([chat.observe(song), chat.observe({ ...song, positionMs: 1000 })]);
    assert.deepEqual(f.messages, ['Now playing "Personal song - Artist".']);
    await chat.observe({ ...song, status: "paused" });
    await chat.observe({ ...song, available: false });
    chat = f.create();
    await chat.load();
    await chat.observe(song);
    assert.equal(f.messages.length, 1);
    await chat.observe(observation(provider, "Next song"));
    await chat.observe(song);
    assert.equal(f.messages.length, 3, "a later repeat after another song is a new change");
    assert.equal(
      JSON.stringify([...f.storage.values()]).includes("Personal song"),
      false,
      "dedupe storage needs only a fingerprint",
    );
  });
}

test("disabled, other-player, stale, missing and non-playing observations remain silent", async () => {
  const f = fixture(),
    chat = f.create();
  await chat.load();
  for (const change of [
    { provider: "spotify" },
    { status: "paused" },
    { status: "stopped" },
    { available: false },
    { observedAt: 84999 },
    { observedAt: 106000 },
    { observedAt: "invalid" },
    { title: "" },
  ])
    await chat.observe({ ...observation("tidal"), ...change });
  f.enable(false);
  await chat.observe(observation("tidal"));
  assert.equal(f.messages.length, 0);
  f.enable(true);
  await chat.observe(observation("tidal"));
  assert.equal(f.messages.length, 1);
});

test("managed library songs announce without requester credit, requests retain verified attribution", async () => {
  const f = fixture("youtube"),
    chat = f.create();
  await chat.load();
  const candidate = { provider: "youtube", title: "Library song", artists: ["Artist"] };
  f.setManaged({ status: "playing", origin: "playlist", candidate, requesterLabel: "Curator" });
  await chat.managed();
  await chat.managed();
  assert.deepEqual(f.messages, ['Now playing "Library song - Artist".']);
  f.setManaged({
    status: "playing",
    origin: "queue",
    candidate: { ...candidate, title: "Requested song" },
    requesterLabel: "Viewer",
  });
  await chat.managed();
  assert.match(f.messages[1], /requested by @Viewer/);
  await chat.observe(observation("youtube", "Requested song"));
  assert.equal(f.messages.length, 2, "an observer echo must not duplicate managed playback");
});

test("desktop request attribution uses only an exact verified occurrence, even without intake chat", async () => {
  const f = fixture(),
    chat = f.create();
  await chat.load();
  await chat.observe(observation("tidal"), {
    candidate: { provider: "tidal", title: "Requested song", artists: ["Artist"] },
    requesterLabel: "Viewer",
    chatNotify: false,
  });
  assert.deepEqual(f.messages, ['Now playing "Requested song - Artist", requested by @Viewer.']);
});

test("failed dedupe storage does not send a message that could repeat after restart", async () => {
  const f = fixture(),
    chat = f.create();
  await chat.load();
  f.storageAvailable(false);
  await chat.observe(observation("tidal"));
  assert.equal(f.messages.length, 0);
  f.storageAvailable(true);
  await chat.observe(observation("tidal"));
  assert.equal(f.messages.length, 1);
});

test("feature announces ordinary selected-player songs without any requests or desktop companion", async () => {
  for (const player of ["tidal", "spotify", "soundcloud", "youtube"]) {
    const storage = new Map([["player-preferences-v1", { player }]]),
      messages = [];
    const harness = createFeatureRuntimeHarness(require("../features/song-request/dist/main"), {
      providers: {
        "ravelink.storage.v1/get": async ({ key }) => ({
          ok: true,
          found: storage.has(key),
          value: structuredClone(storage.get(key)),
        }),
        "ravelink.storage.v1/set": async ({ key, value }) => {
          storage.set(key, structuredClone(value));
          return { ok: true };
        },
        "twitch.chat.send.v1/send": async ({ message }) => {
          messages.push(message);
          return { ok: true };
        },
        "media.windows.now-playing.v1/control": async () => ({ ok: true }),
      },
    });
    try {
      await harness.start();
      await harness.request("song.queue.admin.v1", "configure", {
        responses: { now_playing: true },
      });
      const song = { ...observation(player), observedAt: Date.now() };
      await harness.request("song.playback.observe.v1", "observe", song);
      await harness.request("song.playback.observe.v1", "observe", song);
      assert.deepEqual(messages, ['Now playing "Personal song - Artist".'], player);
      assert.equal(
        harness.calls.some(
          (row) => row.capability === "twitch.rewards.manage.v1" && row.method === "settle",
        ),
        false,
      );
      await harness.stop();
      await harness.start();
      await harness.request("song.playback.observe.v1", "observe", {
        ...song,
        observedAt: Date.now(),
      });
      assert.equal(messages.length, 1, "restart must preserve announcement suppression");
    } finally {
      await harness.stop();
    }
  }
});
