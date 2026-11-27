/** Route chat to the selected player, not the YouTube queue by accident.
 * Native handoffs retain requester hashes after leaving the local queue. Check
 * ownership against those receipts, and remove exact occurrences, never a guessed
 * track ID. Ambiguous titles fail without modifying any queue.
 */
const crypto = require("node:crypto");
const {
  queueView,
  currentReceipt,
  managedCurrent,
  rowId,
  nativeReady,
} = require("./chat-queue-view");
const fail = (reason) => ({ ok: false, code: "rejected", reason });
const text = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
module.exports = function chatPlayerCommands({
  queue,
  preferences,
  tidal,
  spotify,
  youtubeBrowser,
  context,
  changed,
}) {
  return async function route(request) {
    try {
      const payload = request.payload || {},
        self = request.method === "self";
      if (
        !(self && request.capability === "song.queue.submit.v1") &&
        !(
          request.capability === "song.queue.admin.v1" &&
          request.method === "moderate" &&
          (payload.notifyChat === true ||
            (payload.operatorPlayback === true &&
              ["pause", "resume", "volume"].includes(payload.action)))
        )
      )
        return null;
      const action = payload.action;
      if (self && !["remove", "skip"].includes(action)) return null;
      const restrictions = [
        "block",
        "unblock",
        "timeout",
        "untimeout",
        "block_song",
        "unblock_song",
      ];
      if (!["volume", "pause", "resume", "remove", "skip", ...restrictions].includes(action))
        return null;
      const selected = await preferences("status", null);
      if (!selected.ok) return { value: fail("player_preferences_unavailable") };
      const native =
          ["tidal", "spotify"].includes(selected.player) ||
          (selected.player === "youtube" && selected.youtubePlayback === "browser"),
        player =
          selected.player === "tidal"
            ? tidal
            : selected.player === "youtube"
              ? youtubeBrowser
              : spotify;
      const finish = (value) => {
        if (value.ok) changed(value);
        return { value };
      };
      if (["block", "unblock", "timeout", "untimeout"].includes(action)) {
        const requesterKey = queue.requesterModerationKey(payload);
        return finish(
          native ? await player("moderate", { ...payload, requesterKey }) : queue.moderate(payload),
        );
      }
      if (action === "unblock_song")
        return finish(queue.moderate({ ...payload, provider: selected.player }));
      if (action === "volume") {
        const volume = queue.status().volume;
        const output = Math.round(
          volume.floorPercent +
            (payload.value * (volume.ceilingPercent - volume.floorPercent)) / 100,
        );
        if (native) {
          const reply = await player(
            selected.player === "tidal" ? "volume" : "control",
            selected.player === "tidal" ? { percent: output } : { action: "volume", value: output },
          );
          if (!reply.ok)
            return { value: fail(reply.error || reply.reason || "player_control_unavailable") };
        }
        return finish(queue.moderate({ action, value: payload.value }));
      }
      if (["pause", "resume"].includes(action)) {
        if (native) {
          const reply =
            selected.player !== "tidal"
              ? await player("control", { action })
              : await context.callCapability(
                  "media.windows.now-playing.v1",
                  "control",
                  { action, provider: "tidal" },
                  { timeoutMs: 10000 },
                );
          return finish(
            reply.ok
              ? { ok: true, code: "playback_" + action, playbackControl: action }
              : fail(reply.error || reply.reason || "player_control_unavailable"),
          );
        }
        return finish(queue.controlPlayback({ action }));
      }
      const status = native ? await player("status", null) : null;
      const receipt = currentReceipt(status);
      const playback = native ? null : queue.playbackStatus();
      const current = native
        ? status?.current && { ...receipt, ...status.current }
        : managedCurrent(playback, selected.player);
      const { rows, pending, review } = queueView(queue, selected.player, current?.entryId, status);
      const normalize = (row) => ({
        ...row,
        id: rowId(row),
        candidate: row.candidate || {
          provider: selected.player,
          title: row.title || "",
          artists: row.artists,
          providerItemId: row.trackId,
        },
      });
      const owner = self
        ? "req_" +
          crypto
            .createHash("sha256")
            .update(payload.requesterId || "")
            .digest("hex")
        : null;
      let choices = action === "skip" ? [] : [...rows, ...pending, ...review].map(normalize);
      if (current && action !== "remove") choices.unshift(normalize(current));
      if (
        action === "skip" &&
        !self &&
        !current &&
        playback?.managed?.status === "loading" &&
        playback.managed.candidate?.provider === selected.player
      )
        choices.push(normalize(playback.managed));
      if (self) choices = choices.filter((r) => r.requesterKey === owner);
      const query = text(payload.query);
      const position = payload.position || (/^\d{1,3}$/.test(query) ? Number(query) : 0);
      if (native && action === "skip" && (!status?.ok || !status.connected))
        return { value: fail("player_control_unavailable") };
      if (position && (pending.length || (native && !nativeReady(status))))
        return { value: fail("queue_position_unconfirmed") };
      if (payload.entryId) {
        choices = choices.filter((r) => r.id === payload.entryId);
      } else if (position) {
        const entry = rows[position - 1];
        choices = choices.filter((r) => entry && r.id === rowId(entry));
      } else if (query) {
        const exact = choices.filter(
          (r) => text(r.candidate.title) === query || r.id === payload.query,
        );
        choices = exact.length
          ? exact
          : choices.filter((r) => text(r.candidate.title).includes(query));
      } else if (action === "remove") {
        if (choices.length > 1 && (pending.length || review.length))
          return { value: fail("queue_position_unconfirmed") };
        choices = choices.slice(-1);
      }
      if (choices.length !== 1)
        return {
          value: fail(
            choices.length > 1
              ? "song_ambiguous"
              : self && action === "skip"
                ? "not_current_requester"
                : "entry_not_found",
          ),
        };
      const entry = choices[0];
      if (native) {
        if (action === "skip" && !status.current?.uid) return { value: fail("entry_not_found") };
        const reply =
          action === "skip" && selected.player === "spotify"
            ? await player("control", { action, currentUid: status.current.uid })
            : await player("moderate", {
                action,
                entryId: entry.id,
                ...(action === "skip" ? { currentUid: status.current.uid } : {}),
              });
        return finish({
          ...reply,
          ...(!reply.ok ? { reason: reply.reason || reply.error } : {}),
          entry,
        });
      }
      return finish({ ...queue.moderate({ action, entryId: entry.id }), entry });
    } catch {
      return { value: fail("player_control_unavailable") };
    }
  };
};
