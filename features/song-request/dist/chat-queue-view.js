/** Shared view for chat information, request acknowledgements and moderation. */
const ACTIVE_PHASES = new Set(["appended", "playing", "pending", "unknown"]);
const rowId = (row) => row.entryId || row.id;
const nativeReady = (state) => Boolean(state?.ok && state.ready && state.connected);

function currentReceipt(state) {
  const current = state?.current;
  if (!current) return null;
  return (
    (state.handoffs || []).find(
      (row) =>
        ACTIVE_PHASES.has(row.phase) &&
        (current.entryId
          ? row.entryId === current.entryId
          : row.phase === "playing" && row.uid && row.uid === current.uid) &&
        (!row.trackId || !current.trackId || row.trackId === current.trackId),
    ) || null
  );
}

function managedCurrent(playback, provider) {
  const current = playback.managed;
  return current?.candidate?.provider === provider &&
    (current.status === "playing" || (current.status === "paused" && current.started !== false))
    ? current
    : null;
}

function managedPosition(queue, entry, playback) {
  const currentId = managedCurrent({ managed: playback }, entry.candidate.provider)?.entryId;
  return queue.filter(
    (row) => row.candidate.provider === entry.candidate.provider && row.id !== currentId,
  ).length;
}

function queueView(queue, provider, currentId, state) {
  const first = queue.status({ limit: 25 });
  const local = [...first.queue];
  for (let offset = 25; offset < Math.min(200, first.counts.queued); offset += 25)
    local.push(...queue.status({ offset, limit: 25 }).queue);
  const waiting = local.filter(
    (row) => row.candidate.provider === provider && rowId(row) !== currentId,
  );
  const active = new Map(
    (state?.handoffs || [])
      .filter((row) => row.entryId && row.entryId !== currentId && ACTIVE_PHASES.has(row.phase))
      .map((row) => [row.entryId, row]),
  );
  const ordered = new Map(
    (state?.queueOrder || [])
      .filter((id) => active.get(id)?.phase === "appended")
      .map((id) => [id, active.get(id)]),
  );
  const pending = [...active.values()].filter(
    (row) => !ordered.has(row.entryId) && !row.reviewOnly,
  );
  const review = [...active.values()].filter((row) => row.reviewOnly);
  const rows = [...ordered.values(), ...waiting.filter((row) => !active.has(rowId(row)))];
  return { rows, pending, review };
}

module.exports = { queueView, currentReceipt, managedCurrent, managedPosition, rowId, nativeReady };
