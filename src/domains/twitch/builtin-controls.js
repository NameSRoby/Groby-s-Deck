/** Built-in feature controls survive empty runtime, missing rewards and account changes. */
const presets = require("./builtin-presets");
const { fault } = require("../control-deck/control-deck-config");
module.exports = ({ available, getRows, getConnection, isPaused, isClosed, identity }) => ({
  addRows(owner, result, includeUnavailable) {
    if (!available) return result;
    for (const preset of presets) {
      const ready = available(preset.handler);
      if ((!ready && !includeUnavailable) || result.some((row) => row.handler === preset.handler))
        continue;
      result.push({
        id: identity(owner || "public", preset.id),
        accountId: owner || "",
        name: preset.name,
        enabled: ready,
        trigger: { type: "reward", rewardId: "" },
        handler: preset.handler,
        steps: [],
        cooldownSeconds: 0,
        userCooldownSeconds: 15,
        role: "viewer",
        legacy: true,
      });
    }
    return result;
  },
  policy(purpose) {
    const connection = getConnection();
    const owner = connection.connected && connection.userId ? connection.userId : "";
    const row = getRows(owner).find((row) => row.handler === purpose);
    const ready = available ? available(purpose) : Boolean(row);
    const enabled = Boolean(!isClosed() && ready && row?.enabled);
    const chatFallback = enabled && !row.trigger.rewardId;
    const commandPreferred =
      purpose === "song_request" && connection.monitorConfig?.songRequestChatEnabled === true;
    return {
      available: ready,
      enabled,
      chatFallback,
      commandPreferred,
      role: commandPreferred ? "viewer" : row?.role || "viewer",
      chatEnabled: Boolean(
        owner && !isClosed() && ready && !isPaused(purpose) && (commandPreferred || chatFallback),
      ),
    };
  },
  assertRemovable(row) {
    if (available && row.handler !== "flow") throw fault("twitch_builtin_preset_required");
  },
});
