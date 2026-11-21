/** Additional operator-selected Twitch controls. No automatic retries of writes. */
const rewardFields = require("./twitch-reward-fields");
module.exports = ({ request, text, base }) => {
  const headers = (c) => ({
    Authorization: `Bearer ${text(c.accessToken, 2048)}`,
    "Client-Id": text(c.clientId, 80),
    "content-type": "application/json",
  });
  async function reward(input, remove = false) {
    const c = input.credentials || {},
      id = text(input.rewardId, 160);
    if (!id || !c.userId) return { ok: false, error: "twitch_reward_invalid" };
    let body;
    try {
      body = remove ? undefined : JSON.stringify(rewardFields(input));
    } catch {
      return { ok: false, error: "twitch_reward_fields_invalid" };
    }
    const query = new URLSearchParams({ broadcaster_id: c.userId, id });
    const result = await request(`${base}/channel_points/custom_rewards?${query}`, {
      method: remove ? "DELETE" : "PATCH",
      headers: headers(c),
      body,
    });
    if (!result.ok)
      return {
        ok: false,
        error:
          result.status === 403 ? "twitch_reward_not_manageable" : "twitch_reward_write_failed",
        status: result.status,
      };
    return { ok: true, rewardId: id, deleted: remove };
  }
  async function twitchAction(input) {
    const c = input.credentials || {},
      kind = input.kind,
      params = input.params || {};
    let endpoint,
      method = "POST",
      body;
    if (kind === "commercial") {
      if (![30, 60, 90, 120, 150, 180].includes(params.length))
        return { ok: false, error: "twitch_ad_length_invalid" };
      endpoint = "/channels/commercial";
      body = { broadcaster_id: c.userId, length: params.length };
    } else if (kind === "snooze-ad")
      endpoint = "/channels/ads/snooze?" + new URLSearchParams({ broadcaster_id: c.userId });
    else if (kind === "announcement") {
      if (
        typeof params.message !== "string" ||
        !params.message.trim() ||
        params.message.length > 500 ||
        !["primary", "blue", "green", "orange", "purple"].includes(params.color)
      )
        return { ok: false, error: "twitch_announcement_invalid" };
      endpoint =
        "/chat/announcements?" +
        new URLSearchParams({ broadcaster_id: c.userId, moderator_id: c.userId });
      body = { message: params.message.trim(), color: params.color };
    } else if (kind === "shoutout") {
      if (params.target !== "user-id" || !/^\d{1,80}$/.test(params.userId || ""))
        return { ok: false, error: "twitch_shoutout_target_required" };
      endpoint =
        "/chat/shoutouts?" +
        new URLSearchParams({
          from_broadcaster_id: c.userId,
          to_broadcaster_id: params.userId,
          moderator_id: c.userId,
        });
    } else if (kind === "channel-info") {
      if (
        (params.title !== undefined &&
          (typeof params.title !== "string" ||
            !params.title.trim() ||
            params.title.length > 140)) ||
        (params.gameId !== undefined && !/^\d{1,30}$/.test(params.gameId)) ||
        (!params.title && !params.gameId)
      )
        return { ok: false, error: "twitch_channel_info_invalid" };
      endpoint = "/channels?" + new URLSearchParams({ broadcaster_id: c.userId });
      method = "PATCH";
      body = {
        ...(params.title ? { title: params.title } : {}),
        ...(params.gameId ? { game_id: params.gameId } : {}),
      };
    } else return { ok: false, error: "twitch_action_invalid" };
    const result = await request(base + endpoint, {
      method,
      headers: headers(c),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!result.ok)
      return {
        ok: false,
        error:
          result.status === 429
            ? "twitch_action_cooldown"
            : result.status === 403
              ? "twitch_action_not_allowed"
              : result.status === 400
                ? "twitch_action_not_available"
                : "twitch_action_failed",
        status: result.status,
      };
    const row = result.body?.data?.[0];
    if (kind === "commercial" && (!Number.isInteger(row?.length) || row.length < 1))
      return { ok: false, error: "twitch_ad_unconfirmed" };
    return {
      ok: true,
      kind,
      ...(kind === "commercial"
        ? { length: row.length, retryAfter: Math.max(0, Number(row.retry_after) || 0) }
        : {}),
    };
  }
  return {
    updateReward: (input) => reward(input),
    deleteReward: (input) => reward(input, true),
    twitchAction,
  };
};
