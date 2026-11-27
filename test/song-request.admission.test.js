const test = require("node:test"),
  assert = require("node:assert/strict");
const { createSongQueue } = require("../features/song-request/dist/domain");
const createChat = require("../src/capabilities/feature-platform/providers/twitch-chat-command-router");

for (const player of ["tidal", "spotify", "youtube-browser", "youtube", "soundcloud"]) {
  test(`${player}: chat aliases and Channel Points share configured role limits and bans`, async (t) => {
    const provider = player.startsWith("youtube") ? "youtube" : player;
    const queue = createSongQueue(),
      handoffs = [];
    queue.configure({ limits: { maxPerRequester: 2, maxPerVip: 3 } });
    let sequence = 0,
      at = 1000,
      last,
      unavailable = false;
    const candidate = (query) => ({
      provider,
      providerItemId:
        provider === "youtube" ? String(++sequence).padStart(11, "0") : String(++sequence),
      title: query,
      artists: [],
      durationMs: 1000,
    });
    const context = {
      callCapability: async (_cap, method, payload) => {
        if (method === "resolve") return { ok: true, candidate: candidate(payload.query) };
        if (method === "status") {
          if (unavailable) throw Error("offline");
          return { ok: true, ready: false, capacity: { available: 0 }, handoffs };
        }
        return { ok: true };
      },
    };
    const native = ["tidal", "spotify", "youtube-browser"].includes(player);
    const owner =
      player === "tidal"
        ? require("../features/song-request/dist/experimental-tidal")({
            queue,
            context,
            changed() {},
          })
        : native
          ? require("../features/song-request/dist/spotify-player")({
              queue,
              context,
              changed() {},
              providerName: provider,
            })
          : null;
    t.after(() => owner?.stop());
    const submit = async (payload) => {
      last = native
        ? await owner.submit(payload)
        : queue.submit({ ...payload, candidate: candidate(payload.query) });
      if (last.ok && native) {
        handoffs.push({ ...last.entry, entryId: last.entry.id, phase: "appended" });
        queue.settle({ entryId: last.entry.id, outcome: "handed_off" });
      }
      return last;
    };
    const chat = createChat({ now: () => at, submitSongRequest: submit });
    const request = async (user, alias = "!sr", vip = false) => {
      at += 2000;
      return chat.handle(
        {
          message_id: `chat-${at}`,
          chatter_user_id: user,
          chatter_user_name: user,
          broadcaster_user_id: "owner",
          badges: vip ? [{ set_id: "vip" }] : [],
          message: { text: `${alias} Song ${at}` },
        },
        { songRequestChatEnabled: true },
      );
    };
    assert.equal((await request("viewer")).accepted, true);
    assert.equal(
      (
        await submit({
          requestId: "points-1",
          requesterId: "viewer",
          requesterRole: "viewer",
          query: "Points song",
        })
      ).ok,
      true,
    );
    assert.equal((await request("viewer", "!songrequest")).accepted, false);
    assert.equal(last.reason, "requester_limit");
    assert.equal(
      (
        await submit({
          requestId: "points-2",
          requesterId: "viewer",
          requesterRole: "viewer",
          query: "Other points song",
        })
      ).reason,
      "requester_limit",
    );
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await request("vip-user", i % 2 ? "!songrequest" : "!sr", true)).accepted,
        true,
      );
    assert.equal((await request("vip-user", "!sr", true)).accepted, false);
    assert.equal(last.reason, "requester_limit");
    queue.moderate({ action: "block", requesterId: "blocked" });
    assert.equal((await request("blocked")).accepted, false);
    assert.equal(last.reason, "requester_blocked");
    queue.moderate({ action: "timeout", requesterId: "timed", minutes: 5 });
    assert.equal((await request("timed")).accepted, false);
    assert.equal(last.reason, "requester_timed_out");
    if (native) {
      handoffs[0].phase = "unknown";
      assert.equal((await request("viewer")).accepted, false);
      handoffs[0].phase = "finished";
      assert.equal((await request("viewer")).accepted, true, "confirmed completion frees a slot");
      unavailable = true;
      assert.equal((await request("another")).accepted, false);
      assert.equal(last.reason, "request_limits_unavailable");
    }
  });
}

test("native receipts count once during handoff and respect the shared maximum queue size", () => {
  const queue = createSongQueue();
  queue.configure({ limits: { maxPerRequester: 2, maxQueue: 3 } });
  const request = (id) => ({
    requestId: id,
    requesterId: "viewer",
    query: id,
    candidate: { provider: "tidal", providerItemId: id, title: id, artists: [], durationMs: 1000 },
  });
  const first = queue.submit(request("1"));
  const pending = [{ ...first.entry, entryId: first.entry.id, phase: "pending" }];
  assert.equal(queue.submit(request("2"), { pending }).ok, true);
  assert.equal(queue.submit(request("3"), { pending }).reason, "requester_limit");
  pending.push({ entryId: "other-native", requesterKey: "req_other" });
  assert.equal(
    queue.submit(
      { ...request("4"), requesterId: "moderator", requesterRole: "moderator" },
      { pending },
    ).reason,
    "queue_full",
  );
});

for (const player of ["tidal", "spotify"]) {
  test(
    `${player}: in-flight handoff cannot evade the limit or stall other queued viewers`,
    { timeout: 5000 },
    async (t) => {
      const queue = createSongQueue(),
        handoffs = [];
      queue.configure({ limits: { maxPerRequester: 1 } });
      let entered, release;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const candidate = (query) => ({
        provider: player,
        providerItemId: query,
        title: query,
        artists: [],
        durationMs: 1000,
      });
      const context = {
        callCapability: async (_cap, method, payload) => {
          if (method === "resolve") return { ok: true, candidate: candidate(payload.query) };
          if (method === "manage-companion") return { installed: false };
          if (method === "status")
            return {
              ok: true,
              enabled: true,
              connected: true,
              ready: true,
              capacity: { reported: true, available: 10 },
              handoffs,
            };
          if (method === "enqueue") {
            if (payload.candidate.title === "first") {
              entered();
              await gate;
            }
            handoffs.push({ ...payload, phase: "appended" });
            return { ok: true, appended: true, uid: payload.entryId };
          }
          throw Error(method);
        },
      };
      const owner = require(
        player === "tidal"
          ? "../features/song-request/dist/experimental-tidal"
          : "../features/song-request/dist/spotify-player",
      )({ queue, context, changed() {} });
      t.after(() => {
        release();
        owner.stop();
      });
      const request = (id, user) => ({ requestId: id, requesterId: user, query: id });
      assert.equal((await owner.submit(request("first", "viewer"))).ok, true);
      await started;
      const other = queue.submit({
        ...request("other", "other-viewer"),
        candidate: candidate("other"),
      });
      assert.equal(other.ok, true);
      const rejected = owner.submit(request("second", "viewer"));
      await new Promise((resolve) => setImmediate(resolve));
      release();
      assert.equal((await rejected).reason, "requester_limit");
      for (
        let attempt = 0;
        attempt < 100 && !handoffs.some((row) => row.entryId === other.entry.id);
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert(
        handoffs.some((row) => row.entryId === other.entry.id),
        "delivery resumes even when intake is rejected",
      );
    },
  );
}

test("checking native quota never clears an uncertain delivery hold", async () => {
  let paused = true;
  const entry = { id: "held" };
  const worker = require("../features/song-request/dist/tidal-delivery")({
    entries: () => (paused ? [] : [entry]),
    isPaused: () => paused,
    provider: async (method) =>
      method === "manage-companion" ? { installed: false } : { enabled: false },
    send: async () => {
      throw Error("must not retry");
    },
  });
  try {
    worker.hold(entry.id, "tidal_handoff_needs_review");
    worker.trigger();
    assert.equal(worker.error(entry.id), "tidal_handoff_needs_review");
    paused = false;
    worker.trigger();
    await worker.settled();
    assert.equal(worker.error(entry.id), "tidal_handoff_needs_review");
  } finally {
    worker.stop();
  }
});
