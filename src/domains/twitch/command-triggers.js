const {
  COMMAND_ALIASES,
} = require("../../capabilities/feature-platform/providers/twitch-chat-command-router");
const { fault } = require("../control-deck/control-deck-config");
const names = (trigger) => [trigger.command, ...(trigger.aliases || [])];
function normalize(trigger) {
  const command = trigger.command;
  if (typeof command !== "string" || !/^![a-z0-9][a-z0-9_]{0,39}$/.test(command))
    throw fault("twitch_automation_command_reserved");
  const aliases = trigger.aliases ?? [],
    keywords = trigger.keywords ?? [];
  if (
    ![aliases, keywords].every(
      (list) =>
        Array.isArray(list) &&
        list.length <= 32 &&
        list.every((word) => typeof word === "string" && word.length <= 80),
    )
  )
    throw fault("twitch_automation_trigger_invalid");
  if (
    aliases.some((word) => !/^![a-z0-9][a-z0-9_?' -]{0,79}$/.test(word) || word !== word.trim()) ||
    keywords.some(
      (word) => !word.trim() || word !== word.trim().toLowerCase() || /[\r\n]/.test(word),
    )
  )
    throw fault("twitch_automation_trigger_invalid");
  if (trigger.onlyLive !== undefined && typeof trigger.onlyLive !== "boolean")
    throw fault("twitch_automation_trigger_invalid");
  const result = {
    type: "command",
    ...(trigger.onlyLive !== undefined ? { onlyLive: trigger.onlyLive } : {}),
    command,
    ...(aliases.length
      ? { aliases: [...new Set(aliases.filter((word) => word !== command))] }
      : {}),
    ...(keywords.length ? { keywords: [...new Set(keywords)] } : {}),
  };
  if (
    names(result).some(
      (word) => COMMAND_ALIASES.has(word.slice(1)) || ["!clip", "!command"].includes(word),
    )
  )
    throw fault("twitch_automation_command_reserved");
  return result;
}
function overlaps(a, b) {
  return (
    names(a).some((word) => names(b).includes(word)) ||
    (a.keywords || []).some((word) => (b.keywords || []).includes(word))
  );
}
function match(rows, text) {
  const lower = text.toLowerCase();
  const candidates = rows
    .filter((row) => row.trigger.type === "command")
    .flatMap((row) => [
      ...names(row.trigger)
        .filter((word) => lower === word || lower.startsWith(word + " "))
        .map((word) => ({
          row,
          word,
          argv: text.slice(word.length).trim().split(/\s+/).filter(Boolean),
        })),
      ...(row.trigger.keywords || [])
        .filter((word) => lower === word)
        .map((word) => ({ row, word, argv: [] })),
    ]);
  return candidates.sort((a, b) => b.word.length - a.word.length)[0];
}
module.exports = { normalize, overlaps, match };
