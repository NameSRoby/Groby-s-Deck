/** Official EventSub definitions. Optional scopes stay opt-in on Connection. */
const EVENTS = [
  ...["begin", "progress", "lock", "end"].map((suffix) => [
    "channel.prediction." + suffix,
    "Prediction " + suffix,
    "channel:read:predictions",
    "1",
  ]),
  [
    "channel.channel_points_custom_reward_redemption.update",
    "Redemption status changes",
    "channel:manage:redemptions",
    "1",
  ],
  ["channel.shoutout.create", "Native shoutout sent", "moderator:manage:shoutouts", "1"],
  ["channel.chat.message_delete", "Chat message removed", "user:read:chat", "1"],
  ["channel.chat.clear_user_messages", "User messages cleared", "user:read:chat", "1"],
  ["channel.chat.clear", "Chat cleared", "user:read:chat", "1"],
  ["channel.follow", "New follower", "moderator:read:followers", "2"],
  ["channel.subscribe", "New subscriber", "channel:read:subscriptions", "1"],
  ["channel.subscription.end", "Subscription ended", "channel:read:subscriptions", "1"],
  ["channel.subscription.message", "Resubscription message", "channel:read:subscriptions", "1"],
  ["channel.subscription.gift", "Gift subscriptions", "channel:read:subscriptions", "1"],
  ["channel.cheer", "Cheer / Bits", "bits:read", "1"],
  ["channel.raid", "Incoming raid", "", "1"],
  ["stream.online", "Stream goes live", "", "1"],
  ["stream.offline", "Stream goes offline", "", "1"],
  ["channel.ad_break.begin", "Ad break starts", "channel:read:ads", "1"],
  ["channel.hype_train.begin", "Hype Train starts", "channel:read:hype_train", "2"],
  ["channel.hype_train.progress", "Hype Train progresses", "channel:read:hype_train", "2"],
  ["channel.hype_train.end", "Hype Train ends", "channel:read:hype_train", "2"],
  ["channel.poll.begin", "Poll starts", "channel:read:polls", "1"],
  ["channel.poll.progress", "Poll progresses", "channel:read:polls", "1"],
  ["channel.poll.end", "Poll ends", "channel:read:polls", "1"],
];
const scopes = (type) => {
  const scope = EVENTS.find((row) => row[0] === type)?.[2];
  return scope ? [scope] : [];
};
function definitions(userId) {
  return EVENTS.map(([type, , scope, version]) => ({
    type,
    version,
    scope,
    condition:
      type === "channel.raid"
        ? { to_broadcaster_user_id: userId }
        : type.startsWith("channel.chat.")
          ? { broadcaster_user_id: userId, user_id: userId }
          : ["channel.follow", "channel.shoutout.create"].includes(type)
            ? { broadcaster_user_id: userId, moderator_user_id: userId }
            : { broadcaster_user_id: userId },
  }));
}
module.exports = { EVENTS, scopes, definitions };
