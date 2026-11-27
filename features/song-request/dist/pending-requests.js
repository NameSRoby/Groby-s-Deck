/** Merge local entries with trusted native receipts without counting a handoff twice. */
module.exports = function pendingRequests(queue, native, playback) {
  const currentId = playback?.started ? playback.entryId : "";
  const entries = new Map(queue.map((row) => [row.id, row]));
  for (const row of native) {
    const id = row.entryId || row.id;
    if (typeof id === "string" && id && !entries.has(id)) entries.set(id, row);
  }
  return {
    total: entries.size,
    forRequester: (key) =>
      [...entries].filter(([id, row]) => id !== currentId && row.requesterKey === key).length,
  };
};
