/** Shared Twitch goal presets. Event totals and current readings have explicit units. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayGoalSources = factory();
})(globalThis, function () {
  const sources = [
    ["followers", "New followers", "channel.follow", "", 20],
    ["subscriptions", "New subscriptions", "channel.subscribe", "", 10],
    ["resubscriptions", "Resubscriptions", "channel.subscription.message", "", 10],
    ["gift-subscriptions", "Gift subscriptions", "channel.subscription.gift", "total", 10],
    ["bits", "Bits", "channel.cheer", "bits", 1000],
    ["cheers", "Cheer events", "channel.cheer", "", 10],
    ["raids", "Incoming raids", "channel.raid", "", 5],
    ["raiders", "Incoming raiders", "channel.raid", "viewers", 100],
    ["messages", "Chat messages", "channel.chat.message", "", 100],
    [
      "redemptions",
      "Channel Points redemptions",
      "channel.channel_points_custom_reward_redemption.add",
      "",
      25,
    ],
    [
      "redeemed-points",
      "Channel Points redeemed",
      "channel.channel_points_custom_reward_redemption.add",
      "reward.cost",
      10000,
    ],
    ["donations", "Twitch charity donations", "channel.charity_campaign.donate", "amount", 100],
    ["charity-donors", "Charity donation events", "channel.charity_campaign.donate", "", 10],
    ["viewers", "Current viewers", "", "stream.viewers", 100],
    ["follower-total", "Total followers", "", "followers.total", 1000],
    ["subscriber-total", "Active subscribers", "", "subscribers.total", 100],
    ["subscription-points", "Subscription points", "", "subscribers.points", 100],
    ["uptime", "Live minutes", "", "stream.startedAt", 120],
    ["hype-level", "Hype Train level", "channel.hype_train.progress", "level", 5],
    ["hype-points", "Hype Train points", "channel.hype_train.progress", "total", 10000],
    ["poll-votes", "Poll votes", "channel.poll.progress", "votes", 100],
    [
      "prediction-points",
      "Prediction Channel Points",
      "channel.prediction.progress",
      "points",
      10000,
    ],
    [
      "creator-goal",
      "Twitch creator goal progress",
      "channel.goal.progress",
      "current_amount",
      100,
    ],
    ...[
      ["follow", "followers"],
      ["subscription", "net subscription points"],
      ["subscription_count", "net subscriptions"],
      ["new_subscription", "new subscription points"],
      ["new_subscription_count", "new subscriptions"],
      ["new_bit", "Bits"],
      ["new_cheerer", "unique cheerers"],
    ].map(([type, label]) => [
      "creator-" + type.replaceAll("_", "-"),
      "Twitch goal: " + label,
      "channel.goal.progress",
      "current_amount",
      100,
    ]),
    [
      "charity-total",
      "Twitch charity campaign total",
      "channel.charity_campaign.progress",
      "current_amount",
      1000,
    ],
  ].map(([id, name, event, field, target]) => ({
    id,
    name,
    event,
    field,
    target,
    mode:
      !event ||
      id.startsWith("creator-") ||
      ["hype-level", "hype-points", "poll-votes", "prediction-points", "charity-total"].includes(id)
        ? "current"
        : "total",
    goalType:
      id.startsWith("creator-") && id !== "creator-goal" ? id.slice(8).replaceAll("-", "_") : "",
    currency: ["donations", "charity-total"].includes(id),
    scope: event.startsWith("channel.charity_")
      ? "channel:read:charity"
      : event.startsWith("channel.goal.")
        ? "channel:read:goals"
        : event.startsWith("channel.hype_train.")
          ? "channel:read:hype_train"
          : event.startsWith("channel.poll.")
            ? "channel:read:polls"
            : event.startsWith("channel.prediction.")
              ? "channel:read:predictions"
              : event.includes("redemption")
                ? "channel:manage:redemptions"
                : id === "messages"
                  ? "user:read:chat"
                  : ["followers", "follower-total"].includes(id)
                    ? "moderator:read:followers"
                    : ["bits", "cheers"].includes(id)
                      ? "bits:read"
                      : [
                            "subscriptions",
                            "resubscriptions",
                            "gift-subscriptions",
                            "subscriber-total",
                            "subscription-points",
                          ].includes(id)
                        ? "channel:read:subscriptions"
                        : "",
  }));
  const find = (id) =>
    sources.find((s) => s.id === ({ subscribers: "subscriptions", tips: "donations" }[id] || id));
  return { sources, find };
});
