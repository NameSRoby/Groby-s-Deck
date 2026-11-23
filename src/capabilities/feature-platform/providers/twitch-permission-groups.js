/** Optional capabilities mapped to the scopes their existing Helix/EventSub
 * owners use. Identity/validation needs no email or other optional scope.
 * Sources: dev.twitch.tv/docs/authentication/scopes/ and /docs/chat/authenticating */
const GROUPS = Object.freeze([
  {
    id: "charity",
    label: "Charity goals & donations",
    description: "Track Twitch charity campaign totals and incoming donations.",
    scopes: ["channel:read:charity"],
  },
  {
    id: "goals",
    label: "Twitch creator goals",
    description: "Track your Twitch creator goal progress and completion.",
    scopes: ["channel:read:goals"],
  },
  {
    id: "predictions",
    label: "Prediction widgets & events",
    description: "Display Twitch prediction choices, progress and results.",
    scopes: ["channel:read:predictions"],
  },
  {
    id: "chat-presence",
    label: "Chat presence & watchtime",
    description:
      "Sample logged-in chat presence every five minutes while live to estimate watchtime.",
    scopes: ["moderator:read:chatters"],
  },
  {
    id: "rewards",
    label: "Channel Points",
    description:
      "Read and manage Groby’s Deck rewards, receive redemptions, and settle their outcomes.",
    scopes: ["channel:manage:redemptions"],
  },
  {
    id: "chat-read",
    label: "Read chat commands",
    description: "Receive lighting, Song Request and !clip commands through EventSub.",
    scopes: ["user:read:chat"],
  },
  {
    id: "chat-send",
    label: "Send chat replies",
    description: "Send command replies, Song Request updates and created clip links.",
    scopes: ["user:write:chat"],
  },
  {
    id: "roles",
    label: "Moderator and VIP roles",
    description: "Look up requester roles for role limits and command permissions.",
    scopes: ["channel:read:vips", "moderation:read"],
  },
  {
    id: "clips",
    label: "Create stream clips",
    description: "Create clips of your live broadcast from buttons or chat commands.",
    scopes: ["clips:edit"],
  },
  {
    id: "followers",
    label: "Followers & events",
    description:
      "Show recent follower names in status widgets. The total count can work without this access.",
    scopes: ["moderator:read:followers"],
  },
  {
    id: "subscribers",
    label: "Subscribers & events",
    description: "Read your subscriber total and subscription points for dashboard widgets.",
    scopes: ["channel:read:subscriptions"],
  },
  {
    id: "markers",
    label: "Stream title & markers",
    description:
      "Add a marker to your live VOD when you press its button. Local timestamps work without this access.",
    scopes: ["channel:manage:broadcast"],
  },
  {
    id: "ads",
    label: "Ad controls",
    description:
      "Start a commercial or snooze an eligible ad break from your own flows. Does not create any rewards.",
    scopes: ["channel:edit:commercial", "channel:manage:ads", "channel:read:ads"],
  },
  {
    id: "announcements",
    label: "Chat announcements",
    description: "Post an announcement from an operator-authored flow.",
    scopes: ["moderator:manage:announcements"],
  },
  {
    id: "shoutouts",
    label: "Native shoutouts",
    description: "Send Twitch native shoutouts from flows or raid events.",
    scopes: ["moderator:manage:shoutouts"],
  },
  {
    id: "bits",
    label: "Cheer events",
    description: "Trigger a flow when viewers cheer with Bits.",
    scopes: ["bits:read"],
  },
  {
    id: "hype-train",
    label: "Hype Train events",
    description: "Trigger flows at the start, progress or end of a Hype Train.",
    scopes: ["channel:read:hype_train"],
  },
  {
    id: "polls",
    label: "Poll events",
    description: "Trigger flows when a poll starts, progresses or ends.",
    scopes: ["channel:read:polls"],
  },
]);
const DEFAULT_GROUPS = Object.freeze(["rewards", "chat-read", "chat-send", "roles"]);
function normalizeGroups(value, fallback = DEFAULT_GROUPS) {
  if (value === undefined) return [...fallback];
  if (
    !Array.isArray(value) ||
    value.length > GROUPS.length ||
    value.some((id) => typeof id !== "string" || !GROUPS.some((group) => group.id === id)) ||
    new Set(value).size !== value.length
  )
    throw Error("twitch_permission_groups_invalid");
  return GROUPS.filter((group) => value.includes(group.id)).map((group) => group.id);
}
const scopesForGroups = (ids) =>
  [
    ...new Set(GROUPS.filter((group) => ids.includes(group.id)).flatMap((group) => group.scopes)),
  ].sort();
const groupsForScopes = (scopes) =>
  GROUPS.filter((group) => group.scopes.every((scope) => scopes.includes(scope))).map(
    (group) => group.id,
  );
function describe(selected, granted, connected) {
  return GROUPS.map((group) => ({
    ...group,
    scopes: [...group.scopes],
    selected: selected.includes(group.id),
    granted: group.scopes.every((scope) => granted.includes(scope)),
    available: connected && group.scopes.every((scope) => granted.includes(scope)),
    missingScopes: group.scopes.filter((scope) => !granted.includes(scope)),
  }));
}
module.exports = {
  GROUPS,
  DEFAULT_GROUPS,
  normalizeGroups,
  scopesForGroups,
  groupsForScopes,
  describe,
};
