/**
 * Tidal moderation.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#song-requests-providers-and-playback
 */
module.exports = function createTidalModeration({
  queue,
  provider,
  changed,
  waitForDelivery,
  providerName = "tidal",
}) {
  return async function moderate(payload) {
    const action = payload.action;
    const targeted = ["remove", "skip"].includes(action);
    // A handoff may settle after a command chooses a request. Read its local and
    // native state after the in-flight delivery drains to keep the target stable.
    if (targeted) await waitForDelivery();
    let status;
    try {
      status = await provider("status", null);
    } catch {
      status = {};
    }
    if (payload.currentUid && payload.currentUid !== status?.current?.uid)
      return {
        ok: false,
        code: "rejected",
        reason: providerName + "_current_changed",
      };
    const local = require("./chat-queue-view")
      .queueView(queue, providerName)
      .rows.find((row) => row.id === payload.entryId);
    const entry =
      local ||
      status?.handoffs?.find((row) => row.entryId === payload.entryId) ||
      (payload.currentUid ? status?.current : null);
    const trackId = entry?.candidate?.providerItemId || entry?.trackId || payload.providerItemId;
    let result;
    if (targeted && !local) {
      result = entry
        ? { ok: true, code: "removed", entryId: payload.entryId }
        : { ok: false, code: "rejected", reason: "entry_not_found" };
    } else
      result = queue.moderate({
        ...payload,
        ...(["block_song", "timeout_song"].includes(action) && trackId
          ? { provider: providerName, providerItemId: trackId }
          : {}),
      });
    if (!result.ok) return result;
    changed(result);
    if (!["remove", "skip", "block_song", "timeout_song", "block", "timeout"].includes(action))
      return result;
    // Apply restrictions before waiting so new intake sees them immediately.
    if (!targeted) await waitForDelivery();
    const selection = ["block", "timeout"].includes(action)
      ? { requesterKey: payload.requesterKey }
      : ["block_song", "timeout_song"].includes(action)
        ? {
            trackId,
            ...(payload.currentUid ? { currentUid: payload.currentUid } : {}),
          }
        : payload.currentUid
          ? {
              currentUid: payload.currentUid,
              trackId,
              ...(payload.entryId ? { entryId: payload.entryId } : {}),
            }
          : {
              entryId: payload.entryId,
              ...(action === "remove" && providerName === "spotify" ? { queuedOnly: true } : {}),
            };
    if (!Object.values(selection).some(Boolean)) return result;
    let removal;
    try {
      removal = await provider("remove", selection);
    } catch {
      removal = { ok: false, error: providerName + "_companion_unavailable" };
    }
    const native = status?.handoffs?.some(
      (row) =>
        ["appended", "playing", "unknown", "pending"].includes(row.phase) &&
        (selection.entryId
          ? row.entryId === selection.entryId
          : selection.trackId
            ? row.trackId === selection.trackId
            : row.requesterKey === selection.requesterKey),
    );
    if (
      !(removal?.ok && (removal.removed > 0 || removal.skipped === true)) &&
      (native || payload.currentUid || (entry && !local))
    ) {
      const nativeError = removal?.error || providerName + "_remove_unconfirmed";
      if (targeted) return { ok: false, code: "rejected", reason: nativeError };
      return {
        ...result,
        code: providerName + "_moderation_partial",
        nativeError,
      };
    }
    changed(result);
    return {
      ...result,
      nativeRemoved: removal?.removed || 0,
      ...(removal?.removedEntryIds ? { nativeEntryIds: removal.removedEntryIds } : {}),
    };
  };
};
