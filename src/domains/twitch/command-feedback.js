/** Only recognized input errors get a chat response; internal failures stay in run history. */
module.exports = (result, context) => {
  const command = context.command || "!command";
  if (result.code === "twitch_command_target_required")
    return (
      "Choose a player: " +
      command +
      " name (or @name). A new player record is created automatically."
    );
  if (result.code === "twitch_command_target_invalid")
    return (
      "Use a player name with letters, numbers or underscores after " + command + "; @ is optional."
    );
  return "";
};
module.exports.notify = async (result, context, owner, getProvider) => {
  if (result.ok || context.event !== "command") return;
  const provider = getProvider(),
    state = provider.status();
  if (!state.connected || state.userId !== owner) return;
  const message = module.exports(result, context);
  if (!message) return;
  try {
    await provider.sendChat({ message });
  } catch {}
};
