/** Bounded follower checks; no raid-size heuristics and no per-person timers. */
module.exports = ({ store, getProvider, now = Date.now }) => {
  const checks = new Map(),
    pendingChecks = new Map();
  let cursor = 0,
    cleaned = 0,
    detail = "Waiting for the next live presence sample.";
  const owner = () => getProvider().status().userId;
  async function eligible(login, id, subscribed = false) {
    const account = owner(),
      key = account + ":" + login,
      cached = checks.get(key);
    let followed;
    if (cached && cached.until > now()) followed = cached.followed;
    else {
      let request = pendingChecks.get(key);
      if (!request) {
        if (pendingChecks.size >= 4) return false;
        request = Promise.resolve().then(() =>
          getProvider().followAge({ login, ...(id ? { userId: id } : {}) }),
        );
        pendingChecks.set(key, request);
      }
      let result;
      try {
        result = await request;
      } finally {
        if (pendingChecks.get(key) === request) pendingChecks.delete(key);
      }
      if (!result?.ok || owner() !== account) return false;
      followed = !!result.followedAt;
      checks.set(key, { followed, until: now() + 1800000 });
      while (checks.size > 4096) checks.delete(checks.keys().next().value);
    }
    if (!followed) {
      store.forget(account, login);
      store.flush();
      return false;
    }
    return (
      store.tracking(account) === "followers" ||
      subscribed ||
      store.peek(account, login)?.everSubscribed === true
    );
  }
  function maintenance() {
    if (owner() && now() >= cleaned) {
      store.prune(owner(), now());
      store.flush();
      cleaned = now() + 86400000;
    }
  }
  return {
    maintenance,
    async sample(users, current = () => true) {
      const account = owner(),
        mode = store.tracking(account),
        subscribers = new Set();
      const historicalSubscribers = store.subscribedLogins(
        account,
        users.map((row) => row.login),
      );
      const known = users.filter((row) => historicalSubscribers.has(row.login)),
        knownNames = new Set(known.map((row) => row.login));
      const rotated = users.slice(cursor).concat(users.slice(0, cursor));
      cursor = users.length ? (cursor + 200) % users.length : 0;
      const pending = rotated.filter((row) => !historicalSubscribers.has(row.login)).slice(0, 200);
      if (getProvider().status().scopes.includes("channel:read:subscriptions")) {
        for (let offset = 0; offset < pending.length; offset += 100) {
          const batch = pending
            .slice(offset, offset + 100)
            .map((row) => row.id)
            .filter((id) => /^\d{1,80}$/.test(id));
          if (!batch.length || !current() || owner() !== account) break;
          const result = await getProvider().subscriberStatus({ userIds: batch });
          if (result?.ok) result.ids.forEach((id) => subscribers.add(id));
        }
      }
      let budget = 200;
      const accepted = new Set();
      for (const row of [...known, ...rotated.filter((row) => !knownNames.has(row.login))]) {
        if (!current() || owner() !== account) break;
        const subscribed = subscribers.has(row.id) || historicalSubscribers.has(row.login);
        if (mode === "subscribed-followers" && !subscribed) continue;
        const cached = checks.get(account + ":" + row.login);
        if ((!cached || cached.until <= now()) && budget-- <= 0) continue;
        if (await eligible(row.login, row.id, subscribed)) {
          store.touch(account, row.login, now(), subscribed);
          accepted.add(row.login);
        }
      }
      store.flush();
      detail =
        accepted.size +
        " eligible people in the latest sample. Follower checks are cached for 30 minutes; new checks are limited to 200 per sample.";
      return accepted;
    },
    eligible,
    observeChat(event) {
      if (!event.badges?.some((row) => ["subscriber", "founder"].includes(row.set_id))) return;
      const account = owner(),
        login = event.chatter_user_login;
      if (event.broadcaster_user_id !== account || !/^[a-z0-9_]{1,25}$/i.test(login || "")) return;
      void eligible(login.toLowerCase(), event.chatter_user_id, true)
        .then((allowed) => {
          if (allowed && owner() === account) {
            store.touch(account, login.toLowerCase(), now(), true);
            store.flush();
          }
        })
        .catch(() => {});
    },
    observeEvent(type, event) {
      if (!["channel.subscribe", "channel.subscription.message"].includes(type)) return;
      this.observeChat({
        broadcaster_user_id: event?.broadcaster_user_id,
        chatter_user_login: event?.user_login,
        chatter_user_id: event?.user_id,
        badges: [{ set_id: "subscriber" }],
      });
    },
    settings(input = {}) {
      const account = owner();
      if (!account) throw Error("Connect Twitch first.");
      if (input.mode !== undefined) {
        store.tracking(account, input.mode);
        if (input.mode === "subscribed-followers") {
          store.dropUnsubscribed(account);
          store.flush();
        }
        checks.clear();
      }
      maintenance();
      return {
        ok: true,
        mode: store.tracking(account),
        retentionMonths: null,
        storage: store.storageBudget(input.storageLimitBytes),
        tracked: store.count(account),
        detail,
      };
    },
  };
};
