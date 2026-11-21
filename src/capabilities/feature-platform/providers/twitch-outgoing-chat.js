/** One outbound owner: API messages are never eligible as command input. */
module.exports = (now = Date.now, options = {}) => {
  const hash = (value) =>
      require("node:crypto")
        .createHash("sha256")
        .update(
          String(value || "")
            .trim()
            .slice(0, 500)
            .replace(/\s+/g, " "),
        )
        .digest("hex"),
    store = require("./twitch-outgoing-chat-store")(options.file),
    ids = new Map(store.ids.map(([id, sender, channel]) => [id, { sender, channel }])),
    pending = store.pending.map(([sender, channel, digest, at]) => ({
      sender,
      channel,
      digest,
      at,
    }));
  let closed = false;
  const prune = () => {
    for (let index = pending.length - 1; index >= 0; index--)
      if (!pending[index].finish && now() - pending[index].at > 300000) pending.splice(index, 1);
  };
  function persist() {
    if (!options.file) return;
    store.save(
      [...ids].map(([id, row]) => [id, row.sender, row.channel]),
      pending.map((row) => [row.sender, row.channel, row.digest, row.at]),
    );
  }
  function remember(id, row) {
    if (!id || id.length > 160) return;
    ids.set(id, { sender: row.sender, channel: row.channel });
    while (ids.size > 4096) ids.delete(ids.keys().next().value);
  }
  const channels = (event) => [event?.broadcaster_user_id, event?.source_broadcaster_user_id];
  const eventIds = (event) => [event?.message_id, event?.source_message_id].filter(Boolean);
  function known(event) {
    return eventIds(event).some((id) => {
      const row = ids.get(id);
      return row && row.sender === event.chatter_user_id && channels(event).includes(row.channel);
    });
  }
  function remove(row) {
    const index = pending.indexOf(row);
    if (index >= 0) pending.splice(index, 1);
  }
  return {
    async send(sender, input, operation) {
      prune();
      if (closed || pending.length >= 128 || store.blocked)
        return { ok: false, error: "twitch_chat_loop_guard_unavailable" };
      const row = {
        sender: String(sender || "")
          .trim()
          .slice(0, 80),
        channel: String(input?.broadcasterId || sender || "")
          .trim()
          .slice(0, 80),
        digest: hash(input?.message),
        at: now(),
      };
      if (!row.sender || !row.channel) return { ok: false, error: "twitch_chat_request_invalid" };
      row.finished = new Promise((resolve) => {
        row.finish = resolve;
      });
      pending.push(row);
      try {
        // Save only a fingerprint before dispatch, so a restart cannot lose an in-flight send.
        persist();
      } catch {
        remove(row);
        row.finish();
        return { ok: false, error: "twitch_chat_loop_guard_unavailable" };
      }
      try {
        const result = await operation();
        row.id = result?.ok ? String(result.messageId || "") : "";
        const rejected =
          !result?.ok &&
          ((result?.status >= 400 && result.status < 500) ||
            result?.dropped ||
            result?.error === "twitch_chat_dropped" ||
            result?.error === "twitch_chat_request_invalid");
        if (row.id) remember(row.id, row);
        if (row.id || rejected) remove(row);
        return result;
      } finally {
        row.finish();
        delete row.finish;
        try {
          prune();
          persist();
        } catch {
          /* The pre-dispatch fingerprint remains recoverable. */
        }
      }
    },
    async owns(event) {
      if (closed) return true;
      prune();
      if (!event?.chatter_user_id || !eventIds(event).length) return false;
      if (closed || known(event)) return true;
      const digest = hash(event.message?.text),
        matches = pending.filter(
          (row) =>
            row.sender === event.chatter_user_id &&
            channels(event).includes(row.channel) &&
            row.digest === digest,
        );
      if (!matches.length) return false;
      let timer;
      try {
        // EventSub can arrive first. Wait for the ID before mistaking a manually typed copy for an echo.
        await Promise.race([
          Promise.all(matches.map((row) => row.finished)),
          new Promise((resolve) => {
            timer = setTimeout(resolve, options.waitMs || 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (closed || known(event)) return true;
      const uncertain = matches.find((row) => pending.includes(row) && !row.id);
      if (!uncertain) return false;
      for (const id of eventIds(event)) remember(id, uncertain);
      // Consume this ambiguous fingerprint once; future deliveries use the exact ID.
      remove(uncertain);
      try {
        persist();
      } catch {
        /* Keep the in-memory ID even if the disk is unavailable. */
      }
      return true;
    },
    close() {
      closed = true;
      for (const row of pending) row.finish?.();
    },
  };
};
