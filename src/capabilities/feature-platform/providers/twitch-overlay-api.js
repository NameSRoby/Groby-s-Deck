/** Read-only widget queries. Never return tokens, user input, bettors or their IDs. */
module.exports = ({ request, text, base }) => {
  async function read(input, route, query, forChannel = true) {
    const c = input.credentials || {};
    if (!/^\d{1,80}$/.test(c.userId || "") || !c.clientId || !c.accessToken) return { ok: false };
    const params = new URLSearchParams({
      ...(forChannel ? { broadcaster_id: c.userId } : {}),
      ...query,
    });
    return request(base + route + (params.size ? "?" + params : ""), {
      headers: { Authorization: "Bearer " + c.accessToken, "Client-Id": c.clientId },
    });
  }
  return {
    async overlayCreatorGoals(input = {}) {
      const r = await read(input, "/goals");
      return !r.ok
        ? { ok: false }
        : {
            ok: true,
            goals: (r.body.data || []).slice(0, 20).map((row) => ({
              id: text(row.id, 100),
              type: text(row.type, 40),
              current_amount: Math.max(0, Number(row.current_amount) || 0),
              target_amount: Math.max(0, Number(row.target_amount) || 0),
            })),
          };
    },
    async overlayCharity(input = {}) {
      const r = await read(input, "/charity/campaigns");
      if (!r.ok) return { ok: false };
      const row = r.body.data?.[0];
      const money = (v = {}) => ({
        value: Math.max(0, Number(v.value) || 0),
        decimal_places: Math.min(6, Math.max(0, Number(v.decimal_places) || 0)),
        currency: /^[A-Z]{3}$/.test(v.currency || "") ? v.currency : "",
      });
      return {
        ok: true,
        campaign: row
          ? {
              id: text(row.id, 100),
              current_amount: money(row.current_amount),
              target_amount: money(row.target_amount),
            }
          : null,
      };
    },
    async overlayChatBadges(input = {}) {
      const [global, channel] = await Promise.all([
        read(input, "/chat/badges/global", {}, false),
        read(input, "/chat/badges"),
      ]);
      if (!global.ok && !channel.ok) return { ok: false };
      const badges = [];
      for (const result of [global, channel]) {
        if (!result.ok) continue;
        for (const set of (result.body.data || []).slice(0, 500)) {
          for (const version of (set.versions || []).slice(0, 100)) {
            if (
              !/^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[a-z0-9-]+\/[123]$/i.test(
                version.image_url_2x || "",
              )
            )
              continue;
            badges.push({
              key: text(set.set_id, 100) + ":" + text(version.id, 100),
              title: text(version.title, 80) || text(set.set_id, 80),
              url: version.image_url_2x,
            });
          }
        }
      }
      return { ok: true, badges };
    },
    async overlayPrediction(input = {}) {
      const r = await read(input, "/predictions", { first: "1" });
      if (!r.ok) return { ok: false };
      const row = r.body.data?.[0];
      return {
        ok: true,
        prediction: row
          ? {
              id: text(row.id, 100),
              title: text(row.title, 200),
              status: text(row.status, 30),
              winningId: text(row.winning_outcome_id, 100),
              outcomes: (row.outcomes || []).slice(0, 10).map((o) => ({
                id: text(o.id, 100),
                title: text(o.title, 100),
                users: Math.max(0, Number(o.users) || 0),
                points: Math.max(0, Number(o.channel_points) || 0),
              })),
            }
          : null,
      };
    },
    async overlayRedemptions(input = {}) {
      if (!/^[a-zA-Z0-9-]{1,160}$/.test(input.rewardId || "")) throw Error("Choose a reward.");
      const r = await read(input, "/channel_points/custom_rewards/redemptions", {
        reward_id: input.rewardId,
        status: "UNFULFILLED",
        sort: "OLDEST",
        first: "100",
      });
      if (!r.ok) return { ok: false };
      return {
        ok: true,
        truncated: !!r.body.pagination?.cursor,
        entries: (r.body.data || []).slice(0, 100).map((row) => ({
          id: text(row.id, 100),
          rewardId: text(row.reward?.id, 160),
          reward: text(row.reward?.title, 80),
          name: text(row.user_name, 80),
          cost: Math.max(0, Number(row.reward?.cost) || 0),
          at: Date.parse(row.redeemed_at) || 0,
        })),
      };
    },
  };
};
