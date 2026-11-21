/** One bounded, account-owned queue; never replay uncertain writes or old streams. */
module.exports = ({
  getProvider,
  isActive = () => true,
  now = Date.now,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) => {
  let owner = "",
    pending = [],
    after = 0,
    timer = null,
    working = false,
    epoch = 0,
    lastError = "";
  const targets = new Map(),
    GLOBAL = 120000,
    TARGET = 3600000;
  function clear(reset = false) {
    epoch++;
    pending = [];
    if (timer !== null) unschedule(timer);
    timer = null;
    if (reset) {
      targets.clear();
      after = 0;
    }
  }
  function authorized() {
    const state = getProvider().status();
    if (owner !== state.userId) {
      clear(true);
      owner = state.userId || "";
    }
    if (!isActive() || !state.connected || !state.scopes.includes("moderator:manage:shoutouts")) {
      clear();
      return false;
    }
    return !!owner;
  }
  function prune() {
    pending = pending.filter(
      (item) => item.expires > now() && item.valid() && !(targets.get(item.userId) > now()),
    );
    for (const [id, until] of targets) if (until <= now()) targets.delete(id);
  }
  function arm() {
    if (timer !== null) unschedule(timer);
    timer = null;
    if (!pending.length || working) return;
    timer = schedule(
      () => {
        timer = null;
        void tick();
      },
      Math.max(0, after - now()),
    );
    timer?.unref?.();
  }
  async function tick() {
    if (working || !authorized()) return;
    prune();
    if (!pending.length || after > now()) {
      arm();
      return;
    }
    const item = pending[0],
      token = epoch,
      provider = getProvider();
    working = true;
    try {
      const stream = await provider.dashboardStream();
      if (!authorized() || token !== epoch) return;
      if (!stream?.ok || !stream.live) {
        lastError = "twitch_shoutout_not_live";
        clear();
        return;
      }
      prune();
      if (!pending.includes(item) || after > now()) return;
      const result = await provider.runAction({
        kind: "shoutout",
        params: { target: "user-id", userId: item.userId },
      });
      if (!authorized() || token !== epoch) return;
      if (result?.ok) {
        targets.set(item.userId, now() + TARGET);
        after = Math.max(after, now() + GLOBAL + 250);
        lastError = "";
      } else if (result?.error === "twitch_action_cooldown") {
        after = Math.max(after, now() + GLOBAL + 1000);
        if (++item.attempts <= 2) return;
        lastError = result.error;
      } else {
        lastError = result?.error || "twitch_shoutout_outcome_unknown";
        after = Math.max(after, now() + GLOBAL + 1000);
      }
      pending = pending.filter((other) => other !== item);
    } catch {
      // The write may have reached Twitch. Do not replay it.
      pending = pending.filter((other) => other !== item);
      lastError = "twitch_shoutout_outcome_unknown";
      after = Math.max(after, now() + GLOBAL + 1000);
    } finally {
      working = false;
      arm();
    }
  }
  return {
    enqueue(params, valid = () => true) {
      if (!authorized()) return { ok: false, error: "twitch_action_unavailable" };
      if (
        params.target !== "user-id" ||
        !/^\d{1,80}$/.test(params.userId || "") ||
        params.userId === owner
      )
        return { ok: false, error: "twitch_shoutout_target_required" };
      prune();
      if (
        pending.some((item) => item.userId === params.userId) ||
        targets.get(params.userId) > now()
      )
        return { ok: true, queued: false, duplicate: true };
      if (pending.length >= 32) return { ok: false, error: "twitch_shoutout_queue_full" };
      lastError = "";
      pending.push({ userId: params.userId, valid, expires: now() + 7200000, attempts: 0 });
      arm();
      return { ok: true, queued: true };
    },
    receive(type, event) {
      if (!authorized() || event?.broadcaster_user_id !== owner) return;
      if (type === "stream.offline") {
        clear();
        return;
      }
      if (type !== "channel.shoutout.create") return;
      const global = Date.parse(event.cooldown_ends_at),
        target = Date.parse(event.target_cooldown_ends_at);
      if (Number.isFinite(global))
        after = Math.max(after, Math.min(now() + GLOBAL + 1000, global + 250));
      if (/^\d{1,80}$/.test(event.to_broadcaster_user_id || "") && Number.isFinite(target)) {
        targets.set(event.to_broadcaster_user_id, Math.min(now() + TARGET + 1000, target + 250));
        while (targets.size > 256) targets.delete(targets.keys().next().value);
      }
      prune();
      arm();
    },
    snapshot() {
      if (authorized()) prune();
      return {
        pending: pending.length,
        sending: working,
        nextAt: Math.max(now(), after),
        lastError,
      };
    },
    tick,
    clear,
  };
};
