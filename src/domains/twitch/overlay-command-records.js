/** Read only the explicitly selected public records; never render/execute a recipe. */
const { recordKey } = require("../../../public/core/overlay-model");
module.exports = ({ widgets, owner, counterOwner, community }) => {
  if (!/^\d{1,80}$/.test(owner || "")) return {};
  const counter = counterOwner(owner, true),
    result = {};
  const fields = (w) =>
    w.items.filter((field) => /^[a-z][a-z0-9_]{0,23}$/i.test(field)).slice(0, 12);
  const names = widgets
    .filter((w) => w.visible)
    .flatMap((w) =>
      w.type === "goal" && w.goalSource === "counter"
        ? [w.goalCounter, w.goalTargetCounter].filter(Boolean)
        : w.type === "counter"
          ? [w.counterName]
          : w.type === "player-card" && /^[a-z0-9_]{1,25}$/.test(w.player)
            ? fields(w).map((field) => "player " + w.player + " " + field)
            : [],
    );
  const values = counter.readMany(names);
  for (const w of widgets) {
    if (!w.visible || !["leaderboard", "player-card", "counter", "goal"].includes(w.type)) continue;
    const key = recordKey(w);
    if (Object.hasOwn(result, key)) continue;
    if (w.type === "counter") result[key] = { value: values.get(w.counterName) ?? 0 };
    if (w.type === "goal" && w.goalSource === "counter")
      result[key] = {
        value: values.get(w.goalCounter) ?? 0,
        target: values.get(w.goalTargetCounter) ?? 0,
      };
    if (w.type === "leaderboard")
      result[key] = {
        entries:
          w.statSource === "stats"
            ? counter.leaders(w.statField, w.maxItems)
            : community.leaders(owner, w.statSource, w.maxItems),
        unit: w.statSource === "watchtime" ? "minutes" : "",
      };
    if (w.type === "player-card" && /^[a-z0-9_]{1,25}$/.test(w.player))
      result[key] = {
        player: w.player,
        entries: fields(w).map((field) => ({
          field,
          value: values.get("player " + w.player + " " + field) ?? 0,
        })),
      };
  }
  return result;
};
