/** Bound provider access keeps credentials, ownership checks and consent in one owner. */
module.exports = ({
  api,
  withAuthorization,
  getProfile,
  persist,
  clearCatalog,
  sendChat,
  trackMessage,
}) => {
  async function reward(input, remove) {
    const result = await withAuthorization(
      async (credentials) => {
        const inspected = await api.inspectReward({ rewardId: input.rewardId, credentials });
        if (!inspected?.ok || !inspected.exists || !inspected.manageable)
          return { ok: false, error: "twitch_reward_not_manageable" };
        return api[remove ? "deleteReward" : "updateReward"]({ ...input, credentials });
      },
      ["channel:manage:redemptions"],
    );
    if (result?.ok) {
      const profile = getProfile();
      for (const [key, row] of Object.entries(profile.managedRewards || {}))
        if (row.rewardId === input.rewardId) {
          if (remove) delete profile.managedRewards[key];
          else {
            if (input.title !== undefined) row.title = input.title;
            if (input.cost !== undefined) row.cost = input.cost;
          }
        }
      clearCatalog();
      persist();
    }
    return result;
  }
  const scopes = {
    shoutout: "moderator:manage:shoutouts",
    commercial: "channel:edit:commercial",
    "snooze-ad": "channel:manage:ads",
    announcement: "moderator:manage:announcements",
    "channel-info": "channel:manage:broadcast",
    chat: "user:write:chat",
  };
  return {
    updateReward: (input) => reward(input, false),
    deleteReward: (input) => reward(input, true),
    async bindReward(input) {
      if (!/^automation:[a-f0-9]{24}$/.test(input.purpose))
        return { ok: false, error: "twitch_reward_purpose_invalid" };
      const result = await withAuthorization(
        async (credentials) => {
          const inspected = await api.inspectReward({ rewardId: input.rewardId, credentials });
          if (!inspected?.ok || !inspected.exists || !inspected.manageable)
            return { ok: false, error: "twitch_reward_not_manageable" };
          const profile = getProfile();
          if (profile.userId !== credentials.userId)
            return { ok: false, error: "twitch_authorization_changed" };
          if (
            !Object.values(profile.managedRewards).some((row) => row.rewardId === input.rewardId)
          ) {
            profile.managedRewards[input.purpose] = {
              purpose: input.purpose,
              rewardId: input.rewardId,
              title: inspected.title || "",
              cost: 1,
            };
            persist();
            clearCatalog();
          }
          return { ok: true };
        },
        ["channel:manage:redemptions"],
      );
      return result;
    },
    runAction(input) {
      if (input?.kind === "chat" && sendChat) return sendChat(input.params);
      const scope = scopes[input?.kind];
      if (!scope) return { ok: false, error: "twitch_action_invalid" };
      return withAuthorization(
        (credentials) => {
          const operation = () =>
            input.kind === "chat"
              ? api.sendChat({ ...input.params, credentials })
              : api.twitchAction({ ...input, credentials });
          return ["chat", "announcement"].includes(input.kind) && trackMessage
            ? trackMessage(credentials.userId, input.params, operation)
            : operation();
        },
        [scope],
      );
    },
  };
};
