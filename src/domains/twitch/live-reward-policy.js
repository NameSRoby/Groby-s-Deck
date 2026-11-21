/** Pause live-only rewards on Twitch; remember which pauses belong to the app. */
const fs = require("node:fs"),
  path = require("node:path");
function requiresLive(row, catalog) {
  const actions = new Set(
    catalog.filter((action) => action.requiresLive).map((action) => action.id),
  );
  const walk = (nodes) =>
    (nodes || []).some(
      (node) =>
        actions.has(node.actionId) || walk(node.then) || walk(node.else) || walk(node.steps),
    );
  return row.trigger.type === "reward" && row.handler === "flow" && walk(row.steps);
}
module.exports = ({
  file,
  getProvider,
  getRows,
  getCatalog,
  isLive,
  observeLive,
  now = Date.now,
}) => {
  let records = [],
    active = false,
    after = 0,
    chain = Promise.resolve();
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100000) throw Error();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      Array.isArray(saved) &&
      saved.length <= 512 &&
      saved.every(
        (row) =>
          typeof row.owner === "string" &&
          typeof row.id === "string" &&
          typeof row.manual === "boolean" &&
          typeof row.automatic === "boolean",
      )
    )
      records = saved;
  } catch (error) {
    if (error.code !== "ENOENT") active = false;
  }
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(records), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  };
  const owner = () => getProvider().status().userId;
  const eligible = () =>
    getRows().filter((row) => row.trigger.rewardId && requiresLive(row, getCatalog()));
  async function run(force, eventLive) {
    if (!active || (!force && after > now())) return;
    after = now() + 30000;
    const provider = getProvider(),
      account = owner(),
      rows = eligible();
    if (
      !account ||
      !provider.status().connected ||
      (!rows.length && !records.some((row) => row.owner === account))
    )
      return;
    const stream =
      eventLive === undefined ? await provider.dashboardStream() : { ok: true, live: eventLive };
    if (!stream?.ok || owner() !== account || !active) return;
    const result = await provider.listRewards({ force: true });
    if (!result?.ok || owner() !== account || !active) return;
    for (const reward of result.rewards.filter((row) => row.manageable)) {
      if (!active || owner() !== account) return;
      const needed = rows.some((row) => row.trigger.rewardId === reward.id),
        stored = records.find((row) => row.owner === account && row.id === reward.id);
      if (!needed && !stored) continue;
      const entry = stored || {
          owner: account,
          id: reward.id,
          manual: reward.paused === true,
          automatic: false,
        },
        automatic = needed && stream.live !== true,
        paused = entry.manual || automatic;
      if (reward.paused !== paused) {
        const changed = await provider.updateReward({ rewardId: reward.id, paused });
        if (!changed?.ok || owner() !== account) continue;
      }
      if (!stored) records.push(entry);
      const changed = !stored || entry.automatic !== automatic;
      entry.automatic = automatic;
      records = records.slice(-512);
      if (changed) persist();
    }
  }
  return {
    allowRedemption: async (row, owner) =>
      !requiresLive(row, getCatalog()) || (await isLive(owner)),
    observe(type, event) {
      if (
        !["stream.online", "stream.offline"].includes(type) ||
        event?.broadcaster_user_id !== owner()
      )
        return;
      const live = type === "stream.online";
      observeLive(owner(), live);
      void this.sync(true, live).catch(() => {});
    },
    requiresLive: (row) => requiresLive(row, getCatalog()),
    pausedIds: () =>
      records
        .filter((row) => row.owner === owner() && row.automatic && !row.manual)
        .map((row) => row.id),
    edited(id, paused) {
      const entry = records.find((row) => row.owner === owner() && row.id === id);
      if (entry) {
        entry.manual = paused === true;
        persist();
      }
      after = 0;
    },
    sync(force = false, live) {
      const task = chain.then(() => run(force, live));
      chain = task.catch(() => {});
      return task;
    },
    setActive(value) {
      active = value;
      after = 0;
    },
  };
};
