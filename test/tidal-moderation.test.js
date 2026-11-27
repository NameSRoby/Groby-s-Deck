const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdapter } = require("../integrations/tidal-desktop/adapter.cjs");
const createBridge = require("../src/capabilities/feature-platform/providers/experimental-tidal-bridge");
const { createSongQueue } = require("../features/song-request/dist/domain");
const createModeration = require("../features/song-request/dist/tidal-moderation");
const candidate = {
  provider: "tidal",
  providerItemId: "123",
  title: "Requested track",
  artists: ["Artist"],
  durationMs: 100000,
};

test("song timeouts persist, expire, and leave requester access and permanent bans independent", () => {
  let now = 100000;
  const queue = createSongQueue({
    requestProviders: ["tidal"],
    now: () => now,
  });
  queue.submit({
    requestId: "timed",
    requesterId: "viewer",
    query: "track",
    candidate,
  });
  const entry = queue.status().queue[0];
  assert.equal(
    queue.moderate({ action: "timeout_song", entryId: entry.id, minutes: 5 }).timedOutUntil,
    now + 300000,
  );
  assert.equal(queue.status().counts.queued, 0);
  const restored = createSongQueue({
    requestProviders: ["tidal"],
    now: () => now,
  });
  restored.importSnapshot(queue.exportSnapshot());
  assert.equal(
    restored.submit({
      requestId: "blocked",
      requesterId: "other",
      query: "track",
      candidate,
    }).reason,
    "song_timed_out",
  );
  assert.equal(
    restored.submit({
      requestId: "other-song",
      requesterId: "viewer",
      query: "different",
      candidate: { ...candidate, providerItemId: "456" },
    }).ok,
    true,
  );
  now += 300001;
  assert.equal(
    restored.submit({
      requestId: "expired",
      requesterId: "other",
      query: "track",
      candidate,
    }).ok,
    true,
  );
  restored.moderate({
    action: "block_song",
    provider: "tidal",
    providerItemId: "123",
  });
  restored.moderate({
    action: "timeout_song",
    provider: "tidal",
    providerItemId: "123",
    minutes: 1,
  });
  now += 60001;
  assert.equal(
    restored.submit({
      requestId: "still-banned",
      requesterId: "other",
      query: "track",
      candidate,
    }).reason,
    "song_blocked",
  );
});

test("idle delivery triggers do not publish changes or call providers", async () => {
  const worker = require("../features/song-request/dist/tidal-delivery")({
    entries: () => [],
    provider: () => {
      throw new Error("idle provider call");
    },
    send() {},
    updated() {
      throw new Error("idle event");
    },
  });
  for (let index = 0; index < 200; index++) worker.trigger();
  assert.equal(worker.status().processing, false);
  await worker.settled();
  worker.stop();
});

test("native moderation removes only exact requested UIDs, then skips a matching current request", async () => {
  const rows = [
    { uid: "current", mediaItemId: "123", priority: "priority_keep" },
    { uid: "request", mediaItemId: "123", priority: "priority_keep" },
    { uid: "playlist", mediaItemId: "123" },
  ];
  const state = {
    player: "BOOMBOX",
    activePlayer: { activePlayer: "PLAYER_SDK" },
    playQueue: { elements: rows, currentIndex: 0 },
  };
  const calls = [];
  const redux = {
    store: { getState: () => state },
    actions: {
      "playQueue/REMOVE_ELEMENT": ({ uid }) => {
        calls.push(["remove", uid]);
        rows.splice(
          rows.findIndex((row) => row.uid === uid),
          1,
        );
      },
      "playbackControls/SKIP_NEXT": () => {
        calls.push(["skip"]);
        state.playQueue.currentIndex++;
      },
    },
  };
  const adapter = createAdapter(redux, new Set());
  const result = await adapter.remove([
    { uid: "current", trackId: "123" },
    { uid: "request", trackId: "123" },
  ]);
  assert.equal(result.removed, true);
  assert.deepEqual(calls, [["remove", "request"], ["skip"]]);
  assert.equal(rows[state.playQueue.currentIndex].uid, "playlist");
  assert.deepEqual(
    rows.map((row) => row.uid),
    ["current", "playlist"],
  );
  await assert.rejects(
    adapter.remove([{ uid: "playlist", trackId: "999" }]),
    /tidal_remove_invalid/,
  );
  assert.equal(calls.length, 2);
});

test("bridge derives native removal targets from saved receipts and requires explicit confirmation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-tidal-moderation-"));
  const bridge = createBridge({ runtimeDir: root });
  t.after(() => {
    bridge.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const poll = () =>
    bridge.poll({
      companionId: "fixture",
      ready: true,
      moderationReady: true,
      queue: { count: 1, currentUid: "playlist", uids: ["requested"] },
    });
  poll();
  const send = bridge.enqueue({
    entryId: "request-one",
    trackId: "123",
    candidate,
  });
  const append = poll().command;
  bridge.complete({
    id: append.id,
    companionId: "fixture",
    ok: true,
    appended: true,
    uid: "requested",
  });
  await send;
  const removal = bridge.remove({ entryId: "request-one" });
  const command = poll().command;
  assert.equal(command.kind, "remove");
  assert.deepEqual(command.targets, [{ uid: "requested", trackId: "123" }]);
  assert.equal((await bridge.remove({ entryId: "request-one" })).error, "tidal_bridge_busy");
  assert.equal(
    bridge.complete({
      id: command.id,
      companionId: "fixture",
      ok: true,
      removed: true,
      uids: ["other"],
    }).error,
    "tidal_remove_unconfirmed",
  );
  bridge.complete({
    id: command.id,
    companionId: "fixture",
    ok: true,
    removed: true,
    uids: ["requested"],
  });
  assert.equal((await removal).removed, 1);
  assert.equal(bridge.status().handoffs[0].moderated, true);
  assert.equal(bridge.status().capacity.queued, 0);
});

test("song bans apply to delivered TIDAL tracks and user timeouts remove both waiting and native requests", async () => {
  const queue = createSongQueue({ requestProviders: ["tidal", "youtube"] });
  const submitted = queue.submit({
    requestId: "first",
    requesterId: "viewer",
    query: "track",
    requesterName: "Viewer",
    candidate,
  });
  assert.equal(submitted.ok, true);
  const entry = queue.status().queue[0];
  queue.settle({ entryId: entry.id, outcome: "handed_off" });
  const native = {
    entryId: entry.id,
    trackId: "123",
    phase: "appended",
    uid: "native",
    requesterKey: entry.requesterKey,
  };
  const removals = [];
  const moderate = createModeration({
    queue,
    changed() {},
    waitForDelivery: async () => {},
    provider: async (method, payload) => {
      if (method === "status") return { handoffs: [native] };
      removals.push(payload);
      return { ok: true, removed: 1 };
    },
  });
  assert.equal(
    (await moderate({ action: "block_song", provider: "tidal", entryId: entry.id }, [])).ok,
    true,
  );
  assert.equal(
    queue.submit({
      requestId: "second",
      requesterId: "viewer",
      query: "track",
      candidate,
    }).reason,
    "song_blocked",
  );
  const other = { ...candidate, providerItemId: "456" };
  assert.equal(
    queue.submit({
      requestId: "third",
      requesterId: "viewer",
      query: "track",
      candidate: other,
    }).ok,
    true,
  );
  assert.equal(
    (
      await moderate(
        { action: "timeout", requesterKey: entry.requesterKey, minutes: 30 },
        queue.status().queue,
      )
    ).nativeRemoved,
    1,
  );
  assert.equal(queue.status().counts.queued, 0);
  assert.deepEqual(removals, [{ trackId: "123" }, { requesterKey: entry.requesterKey }]);
  assert.equal(
    queue.submit({
      requestId: "fourth",
      requesterId: "viewer",
      query: "track",
      candidate: other,
    }).reason,
    "requester_timed_out",
  );
});

test("a missing native-control companion reports partial moderation instead of claiming removal", async () => {
  const queue = createSongQueue({ requestProviders: ["tidal"] });
  const moderate = createModeration({
    queue,
    changed() {},
    waitForDelivery: async () => {},
    provider: async (method) =>
      method === "status"
        ? {
            handoffs: [{ entryId: "legacy", trackId: "123", phase: "appended" }],
          }
        : { ok: false, error: "tidal_companion_update_required" },
  });
  const result = await moderate({ action: "block_song", entryId: "legacy", provider: "tidal" }, []);
  assert.equal(result.code, "tidal_moderation_partial");
  assert.equal(result.nativeError, "tidal_companion_update_required");
  assert.equal(
    queue.submit({
      requestId: "blocked",
      requesterId: "viewer",
      query: "track",
      candidate,
    }).reason,
    "song_blocked",
  );
});

test("moderation blocks new admission before waiting for an in-flight native delivery", async () => {
  const queue = createSongQueue({ requestProviders: ["tidal"] });
  queue.submit({
    requestId: "inflight",
    requesterId: "viewer",
    query: "track",
    candidate,
  });
  const entry = queue.status().queue[0];
  let release,
    removing = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const moderate = createModeration({
    queue,
    changed() {},
    waitForDelivery: () => gate,
    provider: async (method) =>
      method === "status"
        ? { handoffs: [{ ...entry, entryId: entry.id, phase: "pending" }] }
        : ((removing = true), { ok: true, removed: 1 }),
  });
  const pending = moderate(
    { action: "block", requesterKey: entry.requesterKey },
    queue.status().queue,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.status().counts.queued, 0);
  assert.equal(
    queue.submit({
      requestId: "new",
      requesterId: "viewer",
      query: "track",
      candidate,
    }).reason,
    "requester_blocked",
  );
  assert.equal(removing, false);
  release();
  assert.equal((await pending).nativeRemoved, 1);
});

test("current personal-playlist songs can be banned and skipped without inventing a requester", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-current-song-"));
  const bridge = createBridge({ runtimeDir: root });
  t.after(() => {
    bridge.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const report = {
    companionId: "fixture",
    ready: true,
    moderationReady: true,
    queue: {
      count: 0,
      currentUid: "personal",
      currentTrackId: "123",
      uids: [],
    },
  };
  bridge.poll(report);
  assert.equal(bridge.status().current.trackId, "123");
  assert.equal(bridge.status().current.requesterKey, undefined);
  assert.equal(
    (await bridge.remove({ currentUid: "old-current", trackId: "123" })).error,
    "tidal_current_changed",
  );
  const removal = bridge.remove({ currentUid: "personal", trackId: "123" });
  const command = bridge.poll(report).command;
  assert.deepEqual(command.targets, [{ uid: "personal", trackId: "123" }]);
  bridge.complete({
    id: command.id,
    companionId: "fixture",
    ok: true,
    removed: true,
    uids: ["personal"],
  });
  assert.equal((await removal).removed, 1);
  const queue = createSongQueue({ requestProviders: ["tidal"] });
  const moderate = createModeration({
    queue,
    changed() {},
    waitForDelivery: async () => {},
    provider: async (method) =>
      method === "status"
        ? { current: { uid: "personal", trackId: "123" }, handoffs: [] }
        : { ok: true, removed: 1 },
  });
  assert.equal(
    (await moderate({ action: "block_song", provider: "tidal", currentUid: "old-current" }, []))
      .reason,
    "tidal_current_changed",
  );
  assert.equal(
    (await moderate({ action: "block_song", provider: "tidal", currentUid: "personal" }, []))
      .nativeRemoved,
    1,
  );
  assert.equal(
    queue.submit({
      requestId: "later",
      requesterId: "viewer",
      query: "track",
      candidate,
    }).reason,
    "song_blocked",
  );
});
