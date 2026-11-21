/** Bounded public presentation data. Never forward raw event payloads or credentials. */
const ALERTS = [
  "channel.follow",
  "channel.subscribe",
  "channel.subscription.message",
  "channel.subscription.gift",
  "channel.cheer",
  "channel.raid",
];
const text = (v, n = 500) =>
  typeof v === "string" ? v.replace(/[\x00-\x1f]/g, " ").slice(0, n) : "";
module.exports = function overlayEvents(now = Date.now) {
  let account = "",
    rows = [],
    sequence = 0,
    poll = null,
    hype = null,
    prediction = null;
  return {
    reset(key) {
      if (key !== account) {
        account = key;
        rows = [];
        poll = hype = prediction = null;
      }
    },
    receive(type, event = {}, metadata = {}) {
      const id = text(metadata.message_id || event.message_id, 100);
      if (type.startsWith("channel.prediction.")) {
        prediction = {
          id: text(event.id, 100),
          title: text(event.title, 200),
          status: type.endsWith(".end")
            ? event.status === "resolved"
              ? "RESOLVED"
              : "CANCELED"
            : type.endsWith(".lock")
              ? "LOCKED"
              : "ACTIVE",
          winningId: text(event.winning_outcome_id, 100),
          outcomes: (event.outcomes || []).slice(0, 10).map((row) => ({
            id: text(row.id, 100),
            title: text(row.title, 100),
            points: Math.max(0, Number(row.channel_points) || 0),
            users: Math.max(0, Number(row.users) || 0),
          })),
          at: now(),
        };
        return;
      }
      if (type.startsWith("channel.poll.")) {
        poll = {
          title: text(event.title, 200),
          choices: (event.choices || []).slice(0, 5).map((row) => ({
            title: text(row.title, 100),
            votes: Math.max(0, Number(row.votes) || 0),
          })),
          ended: type.endsWith(".end"),
        };
        return;
      }
      if (type.startsWith("channel.hype_train.")) {
        hype = {
          level: Number(event.level) || 1,
          total: Number(event.total) || 0,
          goal: Number(event.goal) || 0,
          ended: type.endsWith(".end"),
        };
        return;
      }
      if (type === "channel.chat.clear") {
        rows = rows.filter((row) => row.type !== "channel.chat.message");
        return;
      }
      if (type === "channel.chat.clear_user_messages") {
        rows = rows.filter((row) => row.userId !== event.target_user_id);
        return;
      }
      if (type === "channel.chat.message_delete") {
        rows = rows.filter((row) => row.id !== event.message_id);
        return;
      }
      if (id && rows.some((row) => row.id === id)) return;
      if (!ALERTS.includes(type) && type !== "channel.chat.message") return;
      const name = text(
        event.chatter_user_name ||
          event.user_name ||
          event.from_broadcaster_user_name ||
          event.user_login ||
          "Anonymous",
        80,
      );
      const amount = Math.max(
        0,
        Number(event.bits || event.total || event.viewers || event.cumulative_months) || 0,
      );
      const message =
        type === "channel.chat.message"
          ? text(event.message?.text)
          : type === "channel.follow"
            ? "followed"
            : type === "channel.raid"
              ? "raided with " + amount + " viewers"
              : type === "channel.cheer"
                ? "cheered " + amount + " Bits"
                : type === "channel.subscription.gift"
                  ? "gifted " + amount + " subscriptions"
                  : "subscribed";
      rows.push({
        id: id || "overlay-" + ++sequence,
        sequence: ++sequence,
        type,
        name,
        amount,
        message,
        ...(type === "channel.chat.message" && Array.isArray(event.message?.fragments)
          ? {
              fragments: event.message.fragments.slice(0, 32).map((part) => ({
                text: text(part?.text),
                ...(part?.type === "emote" && /^[a-z0-9_]{1,100}$/i.test(part.emote?.id || "")
                  ? { emote: part.emote.id }
                  : {}),
              })),
            }
          : {}),
        userId: text(event.chatter_user_id, 80),
        login: text(event.chatter_user_login, 25).toLowerCase(),
        isAppMessage: metadata.isAppMessage === true,
        at: now(),
      });
      rows = rows.slice(-100);
    },
    snapshot() {
      return structuredClone({
        events: rows.filter((row) => now() - row.at < 3600000),
        poll,
        hype,
        prediction,
      });
    },
  };
};
