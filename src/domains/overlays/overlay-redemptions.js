/** Backfill app-manageable rewards incrementally; EventSub keeps arrivals/removals live. */
module.exports = (now) => {
  let owner = "",
    rows = [],
    ids = [],
    cursor = 0,
    after = 0,
    catalogAfter = 0,
    truncated = false;
  const revisions = new Map();
  let sequence = 0;
  return {
    reset(next) {
      owner = next;
      rows = [];
      ids = [];
      cursor = 0;
      after = catalogAfter = 0;
      revisions.clear();
    },
    receive(type, event) {
      if (
        !type.startsWith("channel.channel_points_custom_reward_redemption.") ||
        !event.id ||
        event.broadcaster_user_id !== owner
      )
        return;
      revisions.set(event.reward?.id, ++sequence);
      while (revisions.size > 1000) revisions.delete(revisions.keys().next().value);
      rows = rows.filter((row) => row.id !== event.id);
      if (String(event.status).toUpperCase() === "UNFULFILLED")
        rows.push({
          id: String(event.id).slice(0, 100),
          rewardId: String(event.reward?.id || "").slice(0, 160),
          reward: String(event.reward?.title || "").slice(0, 80),
          name: String(event.user_name || "").slice(0, 80),
          cost: Number(event.reward?.cost) || 0,
          at: Date.parse(event.redeemed_at) || now(),
        });
      rows = rows.slice(-1000);
    },
    async refresh(provider) {
      if (now() < after || !provider?.overlayRedemptions) return;
      after = now() + 2000;
      const generation = owner;
      if (now() >= catalogAfter) {
        catalogAfter = now() + 600000;
        const result = await provider.listRewards();
        if (generation !== owner || !result.ok) return;
        ids = result.rewards
          .filter((row) => row.manageable)
          .map((row) => row.id)
          .slice(0, 50);
      }
      if (!ids.length) return;
      const id = ids[cursor++ % ids.length],
        started = now(),
        revision = revisions.get(id),
        r = await provider.overlayRedemptions({ rewardId: id });
      if (generation !== owner || !r.ok || revisions.get(id) !== revision) return;
      rows = rows
        .filter((row) => row.rewardId !== id)
        .concat(r.entries)
        .sort((a, b) => a.at - b.at)
        .slice(-1000);
      truncated = r.truncated;
      if (cursor % ids.length === 0) after = started + 30000;
    },
    snapshot: () => ({
      entries: structuredClone(
        rows
          .slice()
          .sort((a, b) => a.at - b.at)
          .slice(0, 100),
      ),
      truncated: truncated || rows.length > 100,
    }),
  };
};
