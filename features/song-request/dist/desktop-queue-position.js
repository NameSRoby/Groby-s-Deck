const { queueView, currentReceipt, rowId, nativeReady } = require("./chat-queue-view");

module.exports = async function desktopQueuePosition(queue, provider, submitted, readStatus) {
  if (!submitted.ok || !submitted.entry) return submitted;
  try {
    const status = await readStatus();
    if (nativeReady(status)) {
      const currentId = status.current?.entryId || currentReceipt(status)?.entryId;
      const { rows, pending } = queueView(queue, provider, currentId, status);
      const index = rows.findIndex((row) => rowId(row) === submitted.entry.id);
      if (!pending.length && index >= 0) return { ...submitted, position: index + 1 };
    }
  } catch {}
  return { ...submitted, position: undefined };
};
