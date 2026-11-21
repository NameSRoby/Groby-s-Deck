/** Read-only widget queries. Never return tokens, user input, bettors or their IDs. */
module.exports = ({ request, text, base }) => {
  async function read(input, route, query) {
    const c = input.credentials || {};
    if (!/^\d{1,80}$/.test(c.userId || "") || !c.clientId || !c.accessToken) return { ok: false };
    return request(
      base + route + "?" + new URLSearchParams({ broadcaster_id: c.userId, ...query }),
      {
        headers: { Authorization: "Bearer " + c.accessToken, "Client-Id": c.clientId },
      },
    );
  }
  return {
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
