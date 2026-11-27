const test = require("node:test"),
  assert = require("node:assert/strict");
const { createFeatureRuntimeHarness } = require("./support/feature-runtime-harness");
const feature = require("../features/song-request/dist/main");

test("every player replies to Twitch intake, failures and confirmed playback exactly once", async (t) => {
  for (const player of ["youtube", "soundcloud", "tidal", "spotify"])
    await t.test(player, async () => {
      const storage = new Map([["player-preferences-v1", { player }]]),
        sent = [];
      const candidate = {
        provider: player,
        providerItemId: {
          youtube: "dQw4w9WgXcQ",
          soundcloud: "123",
          tidal: "123",
          spotify: "AAAAAAAAAAAAAAAAAAAAAA",
        }[player],
        title: "Shared song",
        artists: ["Artist"],
        durationMs: 180000,
      };
      const native = ["tidal", "spotify"].includes(player);
      let reject = false,
        connected = false,
        controlError = "",
        current = null,
        handoffs = [];
      const status = () => ({
        ok: true,
        enabled: true,
        ready: connected,
        connected,
        capacity: { available: 0 },
        current,
        handoffs,
      });
      const resolve = () => {
        if (reject === "throw") throw Error("private provider exception");
        return reject
          ? {
              ok: false,
              reason: player + "_search_unavailable",
              error: player + "_search_unavailable",
            }
          : { ok: true, candidate };
      };
      const control = async () =>
        controlError ? { ok: false, error: controlError } : { ok: true };
      const remove = async () =>
        controlError ? { ok: false, error: controlError } : { ok: true, removed: 1 };
      const harness = createFeatureRuntimeHarness(feature, {
        featureId: "song-request",
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
          "ravelink.storage.v1/remove": async ({ key }) => {
            storage.delete(key);
            return { ok: true };
          },
          "twitch.chat.send.v1/send": async (payload) => {
            sent.push(payload);
            return { ok: true };
          },
          "youtube.catalog.host.v1/resolve": resolve,
          "soundcloud.catalog.host.v1/resolve": resolve,
          "tidal.desktop.experimental.v1/resolve": resolve,
          "spotify.desktop.host.v1/resolve": resolve,
          "tidal.desktop.experimental.v1/status": status,
          "spotify.desktop.host.v1/status": status,
          "spotify.desktop.host.v1/control": control,
          "tidal.desktop.experimental.v1/volume": control,
          "tidal.desktop.experimental.v1/remove": remove,
          "spotify.desktop.host.v1/remove": remove,
          "media.windows.now-playing.v1/control": control,
        },
      });
      try {
        await harness.start();
        assert.equal(
          (await harness.request("song.queue.read.v1", "status", {})).responses.now_playing,
          false,
        );
        const payload = {
          requestId: "chat-1",
          requesterId: "viewer",
          requesterName: "Viewer",
          query: "Shared song",
          notifyChat: true,
          responseMessageId: "message-1",
        };
        const result = await harness.request("song.queue.submit.v1", "submit", payload);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.entry.chatNotify, true);
        assert.equal(sent.length, 1);
        assert.match(sent[0].message, /@Viewer Queued "Shared song - Artist"/);
        assert.equal(sent[0].replyParentMessageId, "message-1");
        await harness.request("song.queue.submit.v1", "submit", payload);
        assert.equal(sent.length, 1, "request replay stays silent");
        reject = true;
        const failed = await harness.request("song.queue.submit.v1", "submit", {
          ...payload,
          requestId: "failed",
          query: "Missing",
        });
        assert.equal(failed.ok, false);
        assert.equal(sent.length, 2);
        assert.match(sent[1].message, /Song Request failed/);
        reject = false;
        await harness.request("song.queue.admin.v1", "moderate", {
          action: "remove",
          entryId: "missing",
          provider: player,
          notifyChat: true,
        });
        assert.equal(sent.length, 3);
        assert.match(sent[2].message, /Remove failed/);
        await harness.request("song.queue.admin.v1", "configure", {
          responses: { now_playing: true },
        });
        if (!native) {
          await harness.request("song.queue.admin.v1", "moderate", {
            action: "playback_start",
            source: player,
          });
          const action = (
            await harness.request("song.playback.driver.v1", "pull", {
              driverId: "fixture",
              providers: [player],
            })
          ).action;
          assert.ok(action);
          const ack = {
            driverId: "fixture",
            leaseId: action.leaseId,
            state: "started",
          };
          await harness.request("song.playback.driver.v1", "acknowledge", ack);
          await harness.request("song.playback.driver.v1", "acknowledge", ack);
        } else {
          handoffs = [
            { ...result.entry, entryId: result.entry.id, uid: "requested", phase: "appended" },
          ];
          current = { uid: "personal" };
          const observation = {
            provider: player,
            sourceId: "fixture",
            available: true,
            status: "playing",
            title: "Personal song",
          };
          await harness.request("song.playback.observe.v1", "observe", observation);
          assert.equal(sent.length, 4, "the personal song announces independently of the handoff");
          assert.match(sent[3].message, /Now playing "Personal song"/);
          assert.doesNotMatch(sent[3].message, /requested by/);
          observation.title = candidate.title;
          handoffs[0].phase = "playing";
          current = {
            uid: "requested",
            entryId: result.entry.id,
            paused: false,
          };
          await harness.request("song.playback.observe.v1", "observe", observation);
          await harness.request("song.playback.observe.v1", "observe", {
            ...observation,
            status: "paused",
          });
          await harness.request("song.playback.observe.v1", "observe", observation);
          await harness.stop();
          await harness.start();
          await harness.request("song.playback.observe.v1", "observe", observation);
        }
        assert.equal(
          sent.length,
          ["tidal", "spotify"].includes(player) ? 5 : 4,
          "confirmed playback announces once across polling and restart",
        );
        assert.match(
          sent.at(-1).message,
          /Now playing "Shared song - Artist", requested by @Viewer/,
        );
        reject = "throw";
        const unavailable = await harness.request("song.queue.submit.v1", "submit", {
          ...payload,
          requestId: "unavailable",
        });
        assert.equal(unavailable.ok, false);
        assert.equal(sent.length, ["tidal", "spotify"].includes(player) ? 6 : 5);
        assert.match(sent.at(-1).message, /Song Request failed/);
        assert.equal(sent.at(-1).message.includes("private provider exception"), false);
        reject = false;
        connected = true;
        const sendCommand = async (action, extra, expected, ok = true, self = false) => {
          const before = sent.length;
          const response = await harness.request(
            self ? "song.queue.submit.v1" : "song.queue.admin.v1",
            self ? "self" : "moderate",
            { action, notifyChat: true, responseMessageId: "moderation-message", ...extra },
          );
          assert.equal(response.ok, ok, JSON.stringify(response));
          assert.equal(sent.length, before + 1, action);
          assert.match(sent.at(-1).message, expected);
          assert.equal(sent.at(-1).replyParentMessageId, "moderation-message");
        };
        await sendCommand("skip", { requesterId: "other" }, /can only skip your own/, false, true);
        await sendCommand(
          "skip",
          { requesterId: "viewer" },
          /"Shared song - Artist" was skipped/,
          true,
          true,
        );
        current = null;
        handoffs = [];
        candidate.providerItemId =
          native && player === "spotify"
            ? "BBBBBBBBBBBBBBBBBBBBBB"
            : player === "youtube"
              ? "zzzzzzzzzzz"
              : "234";
        let next = await harness.request("song.queue.submit.v1", "submit", {
          ...payload,
          requestId: "next",
        });
        assert.equal(next.ok, true, JSON.stringify(next));
        if (native) {
          handoffs = [{ ...next.entry, entryId: next.entry.id, uid: "queued", phase: "appended" }];
          const queued = await harness.request("song.chat.commands.v1", "query", {
            command: "songqueue",
            requesterId: "viewer",
          });
          assert.match(queued.message, /awaiting player confirmation/);
        }
        if (!native) {
          const action = (
            await harness.request("song.playback.driver.v1", "pull", {
              driverId: "fixture",
              providers: [player],
            })
          ).action;
          assert.ok(action);
          const before = sent.length;
          const ack = { driverId: "fixture", leaseId: action.leaseId, state: "failed" };
          await harness.request("song.playback.driver.v1", "acknowledge", ack);
          await harness.request("song.playback.driver.v1", "acknowledge", ack);
          assert.equal(sent.length, before + 1);
          assert.match(sent.at(-1).message, /Playback failed for "Shared song - Artist"/);
          candidate.providerItemId = player === "youtube" ? "yyyyyyyyyyy" : "345";
          next = await harness.request("song.queue.submit.v1", "submit", {
            ...payload,
            requestId: "remove-me",
          });
          assert.equal(next.ok, true, JSON.stringify(next));
        }
        await sendCommand("remove", { entryId: next.entry.id }, /was removed from the queue/);
        handoffs = [];
        await sendCommand("block_song", { entryId: "missing" }, /Song block update failed/, false);
        candidate.providerItemId =
          player === "spotify"
            ? "CCCCCCCCCCCCCCCCCCCCCC"
            : player === "youtube"
              ? "xxxxxxxxxxx"
              : "456";
        const blockedSong = await harness.request("song.queue.submit.v1", "submit", {
          ...payload,
          requestId: "block-me",
        });
        assert.equal(blockedSong.ok, true, JSON.stringify(blockedSong));
        await sendCommand(
          "block_song",
          { entryId: blockedSong.entry.id },
          /was blocked from Song Request/,
        );
        for (const [action, message] of [
          ["block", /was blocked from requesting songs/],
          ["unblock", /can request songs again/],
          ["timeout", /blocked from Song Request for 5 minutes/],
          ["untimeout", /timeout was removed/],
        ]) {
          await sendCommand(action, { requesterName: "Unknown" }, /requester was not found/, false);
          await sendCommand(action, { requesterName: "Viewer", minutes: 5 }, message);
        }
        if (native) {
          controlError = player + "_companion_unavailable";
          await sendCommand("volume", { value: 75 }, /Volume change failed/, false);
          await sendCommand("pause", {}, /Pause failed/, false);
          await sendCommand("resume", {}, /Resume failed/, false);
          controlError = "";
        }
        await sendCommand("volume", { value: 75 }, /volume changed to 75%/);
        await sendCommand("pause", {}, /Music playback is paused/);
        await sendCommand("resume", {}, /Music playback resumed/);
      } finally {
        await harness.stop();
      }
    });
});
