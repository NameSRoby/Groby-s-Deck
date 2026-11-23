/** Buffer zero-cooldown event flows while the runner finishes their previous event. */
module.exports = ({ isBusy, getRows, getOwner, launch, now = Date.now }) => {
  let pending = [];
  function ready() {
    let owner = "";
    try {
      owner = getOwner();
    } catch {
      /* disconnected */
    }
    pending = pending.filter(
      (item) =>
        item.until > now() &&
        item.row.enabled &&
        item.row.accountId === owner &&
        getRows().includes(item.row),
    );
    const available = pending.filter((item) => !isBusy(item.row.id));
    for (const item of available) {
      if (isBusy(item.row.id)) continue;
      pending = pending.filter((other) => other !== item);
      launch(item.row, item.context);
    }
  }
  return {
    start(row, context, run) {
      const queueable =
        row.trigger.type === "event" &&
        (context?.event === "channel.raid" || row.cooldownSeconds === 0);
      if (!queueable || !isBusy(row.id)) return run();
      if (pending.length >= 64)
        return { accepted: false, result: { ok: false, code: "twitch_event_queue_full" } };
      pending.push({ row, context, until: now() + 600000 });
      return { accepted: true, queued: true };
    },
    ready,
    clear() {
      pending = [];
    },
    event(type) {
      if (type === "stream.offline")
        pending = pending.filter((item) => item.context.event !== "channel.raid");
    },
  };
};
