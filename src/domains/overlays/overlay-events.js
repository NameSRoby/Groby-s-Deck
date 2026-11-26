/** Bounded public presentation data. Never forward raw event payloads or credentials. */
const ALERTS = [
  "channel.follow",
  "channel.subscribe",
  "channel.subscription.message",
  "channel.subscription.gift",
  "channel.cheer",
  "channel.raid",
  "channel.charity_campaign.donate",
];
const text = (v, n = 500) =>
  typeof v === "string" ? v.replace(/[\x00-\x1f]/g, " ").slice(0, n) : "";
module.exports = function overlayEvents(now = Date.now) {
  const chat = require("./overlay-chat-history")(now);
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
        chat.reset();
        poll = hype = prediction = null;
      }
    },
    receive(type, event = {}, metadata = {}) {
      if (type.startsWith("channel.chat.")) return chat.receive(type, event, metadata);
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
          at: now(),
        };
        return;
      }
      if (type.startsWith("channel.hype_train.")) {
        hype = {
          level: Number(event.level) || 1,
          total: Number(event.total) || 0,
          goal: Number(event.goal) || 0,
          ended: type.endsWith(".end"),
          at: now(),
        };
        return;
      }
      if (id && rows.some((row) => row.id === id)) return;
      if (!ALERTS.includes(type)) return;
      const name = text(
        event.user_name || event.from_broadcaster_user_name || event.user_login || "Anonymous",
        80,
      );
      const amount = Math.max(
        0,
        Number(event.bits || event.total || event.viewers || event.cumulative_months) || 0,
      );
      const message =
        type === "channel.follow"
          ? "followed"
          : type === "channel.raid"
            ? "raided with " + amount + " viewers"
            : type === "channel.cheer"
              ? "cheered " + amount + " Bits"
              : type === "channel.subscription.gift"
                ? "gifted " + amount + " subscriptions"
                : type === "channel.charity_campaign.donate"
                  ? "donated to charity"
                  : type === "channel.subscription.message"
                    ? "resubscribed for " + amount + " months"
                    : "subscribed";
      rows.push({
        id: id || "overlay-" + ++sequence,
        sequence: ++sequence,
        type,
        name,
        amount:
          type === "channel.charity_campaign.donate"
            ? Math.max(
                0,
                Number(event.amount?.value) /
                  10 ** Math.min(6, Math.max(0, Number(event.amount?.decimal_places) || 0)) || 0,
              )
            : amount,
        currency: /^[A-Z]{3}$/.test(event.amount?.currency || "") ? event.amount.currency : "",
        tier: ["1000", "2000", "3000"].includes(event.tier) ? event.tier : "",
        months: Math.max(0, Number(event.cumulative_months) || 0),
        viewers: Math.max(0, Number(event.viewers) || 0),
        bits: Math.max(0, Number(event.bits) || 0),
        gifts: Math.max(0, Number(event.total) || 0),
        isGift: event.is_gift === true,
        message,
        at: now(),
      });
      rows = rows.slice(-100);
    },
    chatRows: chat.rows,
    snapshot(types) {
      return structuredClone({
        events: rows.filter((row) => (!types || types.has(row.type)) && now() - row.at < 3600000),
        poll,
        hype,
        prediction,
      });
    },
  };
};
