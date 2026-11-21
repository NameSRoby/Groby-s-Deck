/** Account-scoped credit history and lazy shared supporter lists. No background timer. */
const fs = require("node:fs"),
  path = require("node:path");
module.exports = (runtimeDir, now) => {
  let owner = "",
    file = "",
    history = [],
    cache = new Map();
  const clean = (s) => (typeof s === "string" ? s.replace(/[\x00-\x1f]/g, " ").slice(0, 80) : "");
  function reset(id) {
    if (id === owner) return;
    owner = id;
    history = [];
    cache = new Map();
    file = /^\d{1,80}$/.test(id) ? path.join(runtimeDir, "system", "credits-" + id + ".jsonl") : "";
    if (!file) return;
    try {
      if (fs.statSync(file).size <= 3000000)
        history = fs
          .readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .slice(-10000)
          .map((s) => JSON.parse(s))
          .filter(
            (row) =>
              ["followers", "subscribers"].includes(row.kind) &&
              typeof row.name === "string" &&
              Number.isFinite(row.at),
          );
    } catch {
      history = [];
    }
  }
  function updateCachedNames(kind, name, at, ended) {
    const cached = cache.get(kind);
    if (!cached?.value.ok) return;
    const names = cached.value.names.filter((row) => row.name.toLowerCase() !== name.toLowerCase());
    if (!ended) names.unshift({ name, at: kind === "subscribers" ? null : at });
    cached.value = { ...cached.value, names: names.slice(0, 1000) };
    cached.after = Math.min(cached.after, Math.max(at, cached.readAt + 30000));
  }
  function receive(type, event = {}) {
    const ended = type === "channel.subscription.end";
    const kind =
      type === "channel.follow"
        ? "followers"
        : ended || ["channel.subscribe", "channel.subscription.message"].includes(type)
          ? "subscribers"
          : "";
    const name = clean(event.user_name || event.user_login);
    if (!file || !kind || !name) return;
    const at = now();
    updateCachedNames(kind, name, at, ended);
    if (ended) return;
    if (
      history.some(
        (row) =>
          row.kind === kind && row.name.toLowerCase() === name.toLowerCase() && at - row.at < 60000,
      )
    )
      return;
    const row = { kind, name, at };
    history.push(row);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (history.length > 10000) {
      history = history.slice(-10000);
      fs.writeFileSync(file, history.map(JSON.stringify).join("\n") + "\n", { mode: 0o600 });
    } else fs.appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
  }
  async function data(status, widgets) {
    const generation = owner,
      result = { history: [], recordedSince: history[0]?.at || null };
    for (const kind of ["followers", "subscribers"]) {
      if (!widgets.some((w) => w.visible && w.type === "credits" && w.creditsSource === kind))
        continue;
      const scope =
        kind === "followers" ? "moderator:read:followers" : "channel:read:subscriptions";
      if (!status.scopes.includes(scope)) {
        cache.delete(kind);
        result[kind] = { ok: false, names: [] };
        continue;
      }
      let entry = cache.get(kind);
      if (!entry || now() >= entry.after) {
        const started = now();
        entry = {
          after: started + 900000,
          readAt: started,
          value: entry?.value || { ok: false, names: [] },
        };
        cache.set(kind, entry);
        const previous = entry.value;
        try {
          const fresh = await status.provider.overlaySupporters({ kind });
          if (entry.value === previous) entry.value = fresh;
        } catch {
          if (entry.value === previous) entry.value = { ok: false, names: [] };
        }
        if (!entry.value?.ok) entry.after = started + 30000;
      }
      result[kind] = { ...entry.value, names: entry.value?.names || [] };
    }
    if (result.subscribers?.ok) {
      const current = new Set(result.subscribers.names.map((row) => row.name.toLowerCase()));
      const latest = new Map();
      for (const row of history)
        if (row.kind === "subscribers" && current.has(row.name.toLowerCase()))
          latest.set(row.name.toLowerCase(), row);
      result.history = [...latest.values()].slice(-1000);
    }
    return generation === owner ? result : { history: [] };
  }
  return { reset, receive, data };
};
