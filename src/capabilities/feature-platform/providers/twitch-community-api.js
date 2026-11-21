/** Fixed Helix endpoints for community commands; no credentials leave the owner. */
module.exports = ({ request, base }) => {
  const get = async (c, route, query) =>
    request(base + route + "?" + new URLSearchParams(query), {
      headers: { Authorization: "Bearer " + c.accessToken, "Client-Id": c.clientId },
    });
  return {
    async searchCategories({ credentials: c, query }) {
      const result = await get(c, "/search/categories", { query, first: "100" });
      return result.ok
        ? {
            ok: true,
            categories: (result.body?.data || []).map((row) => ({ id: row.id, name: row.name })),
          }
        : { ok: false, error: "Category search failed." };
    },
    async followAge({ credentials: c, login, userId }) {
      let id = userId;
      if (!id) {
        const user = await get(c, "/users", { login });
        id = user.body?.data?.[0]?.id;
        if (!user.ok || !id) return { ok: false, error: "User not found." };
      }
      if (!/^\d{1,80}$/.test(id)) return { ok: false, error: "Invalid user." };
      const result = await get(c, "/channels/followers", {
        broadcaster_id: c.userId,
        user_id: id,
        first: "1",
      });
      if (!result.ok)
        return { ok: false, error: "Enable Followers & events access in Twitch Connection." };
      return { ok: true, followedAt: result.body?.data?.[0]?.followed_at || null };
    },
    async subscriberStatus({ credentials: c, userIds }) {
      if (
        !Array.isArray(userIds) ||
        userIds.length > 100 ||
        !userIds.every((id) => /^\d{1,80}$/.test(id))
      )
        return { ok: false };
      const query = new URLSearchParams({ broadcaster_id: c.userId, first: "100" });
      userIds.forEach((id) => query.append("user_id", id));
      const result = await request(base + "/subscriptions?" + query, {
        headers: { Authorization: "Bearer " + c.accessToken, "Client-Id": c.clientId },
      });
      return result.ok
        ? { ok: true, ids: (result.body?.data || []).map((row) => row.user_id) }
        : { ok: false };
    },
    async listChatters({ credentials: c }) {
      const users = [];
      let after = "";
      for (let page = 0; page < 25; page++) {
        const result = await get(c, "/chat/chatters", {
          broadcaster_id: c.userId,
          moderator_id: c.userId,
          first: "1000",
          ...(after ? { after } : {}),
        });
        if (!result.ok)
          return { ok: false, error: "Watchtime tracking needs Chat presence access." };
        users.push(
          ...(result.body?.data || []).map((row) => ({ id: row.user_id, login: row.user_login })),
        );
        after = result.body?.pagination?.cursor;
        if (!after) return { ok: true, users };
      }
      return {
        ok: false,
        error: "Chatter list exceeded the tracking limit; no partial credit applied.",
      };
    },
  };
};
