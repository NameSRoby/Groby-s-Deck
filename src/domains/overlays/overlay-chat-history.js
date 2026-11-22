/** Twitch chat history, including moderation that arrives while an incoming echo is classified. */
const text = (value, limit = 500) =>
  typeof value === "string" ? value.replace(/[\x00-\x1f]/g, " ").slice(0, limit) : "";
const validPart = (value) => /^[a-z0-9_-]{1,100}$/i.test(value || "");
const recentMs = 3600000;

module.exports = (now) => {
  const deleted = new Map();
  const cleared = new Map();
  let rows = [];
  let roomClear = 0;
  let sequence = 0;
  function remember(map, key, value) {
    if (!key) return;
    map.delete(key);
    map.set(key, value);
    if (map.size > 500) map.delete(map.keys().next().value);
  }
  return {
    reset() {
      rows = [];
      deleted.clear();
      cleared.clear();
      roomClear = 0;
      sequence = 0;
    },
    receive(type, event, metadata) {
      const order = metadata.chatOrder ?? sequence + 1;
      sequence = Math.max(sequence, order);
      if (type === "channel.chat.clear") {
        roomClear = Math.max(roomClear, order);
        rows = rows.filter((row) => row.sequence > order);
        return true;
      }
      if (type === "channel.chat.clear_user_messages") {
        const id = text(event.target_user_id, 80);
        remember(cleared, id, Math.max(cleared.get(id) || 0, order));
        if (id) rows = rows.filter((row) => row.userId !== id || row.sequence > order);
        return true;
      }
      if (type === "channel.chat.message_delete") {
        const id = text(event.message_id, 100);
        remember(deleted, id, now());
        if (id) rows = rows.filter((row) => row.id !== id);
        return true;
      }
      if (type !== "channel.chat.message") return false;
      const id = text(event.message_id || metadata.message_id, 100);
      const userId = text(event.chatter_user_id, 80);
      if (
        order <= roomClear ||
        order <= (cleared.get(userId) || 0) ||
        (deleted.has(id) && now() - deleted.get(id) < recentMs) ||
        (id && rows.some((row) => row.id === id))
      )
        return false;
      const badges = (Array.isArray(event.badges) ? event.badges : [])
        .slice(0, 15)
        .filter((badge) => validPart(badge?.set_id) && validPart(badge?.id))
        .map((badge) => badge.set_id + ":" + badge.id);
      const fragments = Array.isArray(event.message?.fragments)
        ? event.message.fragments.slice(0, 150).map((part) => ({
            text: text(part?.text),
            ...(part?.type === "emote" && validPart(part.emote?.id)
              ? { emote: part.emote.id }
              : {}),
          }))
        : undefined;
      rows.push({
        id: id || "chat-" + order,
        sequence: order,
        type,
        name: text(event.chatter_user_name || event.chatter_user_login || "Anonymous", 80),
        message: text(event.message?.text),
        fragments,
        badges,
        color: /^#[a-f0-9]{6}$/i.test(event.color || "") ? event.color : "",
        userId,
        login: text(event.chatter_user_login, 25).toLowerCase(),
        isAppMessage: metadata.isAppMessage === true,
        at: now(),
      });
      rows.sort((left, right) => left.sequence - right.sequence);
      if (rows.length > 100) rows.shift();
      return true;
    },
    rows: () => rows.filter((row) => now() - row.at < recentMs),
  };
};
