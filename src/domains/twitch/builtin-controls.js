/** Built-in feature controls survive empty runtime, missing rewards and account changes. */
const presets = require("./builtin-presets");
const { fault } = require("../control-deck/control-deck-config");
const prefersChat = (purpose, connection) =>
  purpose === "song_request" && connection.monitorConfig?.songRequestChatEnabled === true;
const switchEnabled = (row, chatPreferred) =>
  Boolean(row && !row.builtinPaused && (row.enabled || chatPreferred));
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
        enabled: true,
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
    const row = getRows(owner, true).find((row) => row.handler === purpose);
    const ready = available ? available(purpose) : Boolean(row);
    const commandPreferred = prefersChat(purpose, connection);
    const requested = switchEnabled(row, commandPreferred);
    const enabled = Boolean(!isClosed() && ready && requested);
    const chatFallback = enabled && row.enabled && !row.trigger.rewardId;
    return {
      available: ready,
      enabled,
      switchEnabled: requested,
      chatFallback,
      commandPreferred,
      role: row?.role || "viewer",
      chatEnabled: Boolean(
        owner && enabled && !isPaused(purpose) && (commandPreferred || chatFallback),
      ),
    };
  },
  toggled(row, operation) {
    const builtin = available && row.handler !== "flow";
    const previous = builtin
      ? switchEnabled(row, prefersChat(row.handler, getConnection()))
      : row.enabled;
    row.enabled = operation === "pause" ? false : operation === "toggle" ? !previous : true;
    if (builtin && !row.enabled) row.builtinPaused = true;
    else delete row.builtinPaused;
  },
  prepareEdit(existing, row, rows) {
    if (!available) return;
    if (existing && existing.handler !== "flow" && existing.handler !== row.handler)
      throw fault("twitch_builtin_preset_required");
    if (
      row.handler !== "flow" &&
      existing?.handler !== row.handler &&
      rows.some((other) => other.handler === row.handler)
    )
      throw fault("twitch_builtin_preset_required");
    if (existing?.builtinPaused) row.builtinPaused = true;
  },
  assertRemovable(row) {
    if (available && row.handler !== "flow") throw fault("twitch_builtin_preset_required");
  },
});
