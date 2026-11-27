const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESPONSE_KINDS,
  composeChatResponse,
  responseKind,
} = require("../features/song-request/dist/chat-responses");

const enabled = (kind) => ({ responses: { [kind]: true }, queue: [] });

test("all response settings have the requested fresh defaults and preserve saved choices", () => {
  const { createSongQueue } = require("../features/song-request/dist/domain");
  const queue = createSongQueue();
  const defaults = Object.fromEntries(RESPONSE_KINDS.map((kind) => [kind, kind !== "now_playing"]));
  assert.deepEqual(queue.status().responses, defaults);
  queue.configure({ responses: { queued: false, now_playing: true } });
  const restored = createSongQueue();
  restored.importSnapshot(queue.exportSnapshot());
  assert.deepEqual(restored.status().responses, { ...defaults, queued: false, now_playing: true });
});

test("every response has an exact public message, preserves its reply target and respects its toggle", () => {
  const cases = [
    ["queued", "submit", "", true, '@Viewer Queued "Track - Artist" at position 2.'],
    [
      "queue_failed",
      "submit",
      "",
      false,
      "@Viewer Song Request failed: the queue is full.",
      { reason: "queue_full" },
    ],
    [
      "now_playing",
      "acknowledge",
      "",
      true,
      'Now playing "Track - Artist", requested by @Viewer.',
      { code: "started" },
    ],
    [
      "playback_failed",
      "acknowledge",
      "",
      false,
      'Playback failed for "Track - Artist". The item was removed from the queue.',
      { code: "failed" },
    ],
    ["skip_succeeded", "self", "skip", true, '"Track - Artist" was skipped.'],
    [
      "skip_failed",
      "self",
      "skip",
      false,
      "Skip failed: you can only skip your own currently playing song.",
      { reason: "not_current_requester" },
    ],
    [
      "remove_succeeded",
      "moderate",
      "remove",
      true,
      '"Track - Artist" was removed from the queue.',
    ],
    [
      "remove_failed",
      "moderate",
      "remove",
      false,
      "Remove failed: removing queued Spotify tracks requires the desktop companion.",
      { reason: "spotify_queue_removal_unsupported" },
    ],
    [
      "song_ban_succeeded",
      "moderate",
      "block_song",
      true,
      '"Track - Artist" was blocked from Song Request.',
    ],
    [
      "song_ban_succeeded",
      "moderate",
      "unblock_song",
      true,
      '"Track - Artist" can be requested again.',
    ],
    [
      "song_ban_failed",
      "moderate",
      "block_song",
      false,
      "Song block update failed: the requested queue item was not found.",
    ],
    [
      "user_ban_succeeded",
      "moderate",
      "block",
      true,
      "@Viewer was blocked from requesting songs; 1 pending request was removed.",
      { removed: 1 },
    ],
    [
      "user_ban_failed",
      "moderate",
      "block",
      false,
      "Requester access update failed: that requester was not found.",
      { reason: "invalid_requester" },
    ],
    [
      "user_ban_failed",
      "moderate",
      "unblock",
      false,
      "Requester access update failed: that requester was not found.",
      { reason: "invalid_requester" },
    ],
    ["user_restored", "moderate", "unblock", true, "@Viewer can request songs again."],
    [
      "user_timeout_succeeded",
      "moderate",
      "timeout",
      true,
      "@Viewer was blocked from Song Request for 5 minutes.",
    ],
    [
      "user_timeout_failed",
      "moderate",
      "timeout",
      false,
      "Requester timeout failed: that requester was not found.",
      { reason: "invalid_requester" },
    ],
    [
      "user_timeout_failed",
      "moderate",
      "untimeout",
      false,
      "Requester timeout failed: that requester was not found.",
      { reason: "invalid_requester" },
    ],
    [
      "user_timeout_removed",
      "moderate",
      "untimeout",
      true,
      "@Viewer Song Request timeout was removed.",
    ],
    [
      "volume_changed",
      "moderate",
      "volume",
      true,
      "Song Request volume changed to 75% (output 30%).",
      { volume: { outputPercent: 30 } },
    ],
    [
      "volume_failed",
      "moderate",
      "volume",
      false,
      "Volume change failed: the active Spotify device does not support volume control.",
      { reason: "spotify_volume_unavailable" },
    ],
    ["intake_paused", "moderate", "pause", true, "Song Request intake is paused."],
    [
      "intake_paused",
      "moderate",
      "pause",
      true,
      "Music playback is paused.",
      { playbackControl: "pause" },
    ],
    [
      "intake_paused",
      "moderate",
      "pause",
      false,
      "Pause failed: Spotify did not allow this playback control.",
      { reason: "spotify_playback_restricted" },
    ],
    ["intake_resumed", "moderate", "resume", true, "Song Request intake is open."],
    [
      "intake_resumed",
      "moderate",
      "resume",
      true,
      "Music playback resumed.",
      { playbackControl: "resume" },
    ],
    [
      "intake_resumed",
      "moderate",
      "resume",
      false,
      "Resume failed: Spotify did not allow this playback control.",
      { reason: "spotify_playback_restricted" },
    ],
  ];
  assert.deepEqual(new Set(cases.map(([kind]) => kind)), new Set(RESPONSE_KINDS));
  for (const [kind, method, action, ok, message, extra] of cases) {
    const request = {
      method,
      payload: {
        action,
        notifyChat: true,
        responseMessageId: "fixture-message",
        requesterName: "Viewer",
        minutes: 5,
        value: 75,
      },
    };
    const result = {
      ok,
      position: 2,
      reason: "entry_not_found",
      entry: { candidate: { title: "Track", artists: ["Artist"] } },
      ...extra,
    };
    assert.deepEqual(
      composeChatResponse(request, result, enabled(kind)),
      { kind, message, replyParentMessageId: "fixture-message" },
      kind,
    );
    assert.equal(composeChatResponse(request, result, enabled("other")), null, kind);
    assert.equal(
      composeChatResponse(
        { ...request, payload: { ...request.payload, notifyChat: false } },
        result,
        enabled(kind),
      ),
      null,
      kind,
    );
  }
});

test("replayed intake never posts another rejection reply", () => {
  assert.equal(
    composeChatResponse(
      { method: "submit", payload: { notifyChat: true } },
      { ok: false, code: "duplicate", reason: "request_replay" },
      enabled("queue_failed"),
    ),
    null,
  );
  assert.match(
    composeChatResponse(
      { method: "submit", payload: { notifyChat: true } },
      { ok: false, code: "duplicate", reason: "item_duplicate" },
      enabled("queue_failed"),
    ).message,
    /already queued/,
  );
});

test("native Song Request chat outcomes are independently gated and sanitized", () => {
  const request = {
    method: "submit",
    payload: {
      notifyChat: true,
      responseMessageId: "message-1",
      requesterName: "Viewer",
      query: "Example song",
    },
  };
  assert.equal(
    composeChatResponse(request, { ok: true, position: 2 }, { responses: {}, queue: [] }),
    null,
  );
  assert.deepEqual(composeChatResponse(request, { ok: true, position: 2 }, enabled("queued")), {
    kind: "queued",
    message: "@Viewer Queued that song at position 2.",
    replyParentMessageId: "message-1",
  });
  assert.equal(
    composeChatResponse(
      { ...request, payload: { ...request.payload, notifyChat: false } },
      { ok: true },
      enabled("queued"),
    ),
    null,
  );
  assert.equal(RESPONSE_KINDS.length, new Set(RESPONSE_KINDS).size);
});

test("response classification covers moderation success and failure without raw errors", () => {
  assert.equal(
    responseKind({ method: "moderate", payload: { action: "block_song" } }, { ok: true }),
    "song_ban_succeeded",
  );
  assert.equal(
    responseKind({ method: "moderate", payload: { action: "remove" } }, { ok: false }),
    "remove_failed",
  );
  const response = composeChatResponse(
    { method: "moderate", payload: { action: "remove", notifyChat: true } },
    { ok: false, reason: "entry_not_found", error: "private backend detail" },
    enabled("remove_failed"),
  );
  assert.equal(response.message, "Remove failed: the requested queue item was not found.");
  assert.equal(response.message.includes("private backend detail"), false);
  const unrelatedQueue = {
    responses: { remove_failed: true },
    queue: [{ id: "other", candidate: { title: "Wrong track" } }],
  };
  assert.equal(
    composeChatResponse(
      { method: "moderate", payload: { action: "remove", notifyChat: true } },
      { ok: false, reason: "entry_not_found" },
      unrelatedQueue,
    ).message,
    "Remove failed: the requested queue item was not found.",
  );
});

test("now-playing composition requires an eligible playback notification", () => {
  const request = { method: "acknowledge", payload: {} };
  assert.equal(
    composeChatResponse(
      request,
      { ok: true, code: "started", notifyChat: false },
      enabled("now_playing"),
    ),
    null,
  );
  const response = composeChatResponse(
    request,
    {
      ok: true,
      code: "started",
      notifyChat: true,
      entryId: "song-1",
    },
    {
      responses: { now_playing: true },
      queue: [
        {
          id: "song-1",
          requesterLabel: "Viewer",
          candidate: { title: "Track" },
        },
      ],
    },
  );
  assert.equal(response.message, 'Now playing "Track", requested by @Viewer.');
});

test("public song formatting never coerces private metadata or falls back to request queries", () => {
  const { publicSong, songLabel } = require("../features/song-request/dist/chat-public-song");
  const privateData = {
    playlistName: "PRIVATE_PLAYLIST",
    accountName: "PRIVATE_ACCOUNT",
    email: "private@example.invalid",
    token: "PRIVATE_TOKEN",
  };
  assert.deepEqual(
    publicSong({ ...privateData, title: "Track", artists: ["Artist", privateData] }),
    {
      provider: "",
      title: "Track",
      artists: ["Artist"],
    },
  );
  for (const value of [
    privateData,
    "private@example.invalid",
    "Bearer PRIVATE_TOKEN",
    "C:\\Users\\Private\\song.mp3",
    "https://service.invalid/playlist/PRIVATE_PLAYLIST?access_token=PRIVATE_TOKEN",
  ]) {
    assert.equal(songLabel({ title: value, artists: ["Artist"] }), "");
  }
  const message = composeChatResponse(
    { method: "acknowledge", payload: { query: "PRIVATE_QUERY", notifyChat: true } },
    {
      ok: true,
      code: "started",
      notifyChat: true,
      entry: {
        ...privateData,
        query: "PRIVATE_QUERY",
        requesterLabel: "Viewer",
        candidate: { ...privateData, artists: [privateData] },
      },
    },
    enabled("now_playing"),
  );
  assert.equal(message.message, "Now playing that song, requested by @Viewer.");
  assert.doesNotMatch(message.message, /PRIVATE_|private@example/);
});
