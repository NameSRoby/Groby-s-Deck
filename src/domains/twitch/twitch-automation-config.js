/** Only operators author action parameters; viewer messages never become commands. */
const { steps, closed, fault } = require("../control-deck/control-deck-config");
const {
  COMMAND_ALIASES,
} = require("../../capabilities/feature-platform/providers/twitch-chat-command-router");
const HANDLERS = ["flow", "lights", "teach", "song_request", "add_to_playlist"];
function normalize(input, accountId, { canonicalize = true } = {}) {
  if (
    !closed(input, [
      "id",
      "name",
      "enabled",
      "trigger",
      "handler",
      "steps",
      "cooldownSeconds",
      "userCooldownSeconds",
      "role",
    ]) ||
    JSON.stringify(input).length > 120000
  )
    throw fault("twitch_automation_invalid");
  if (
    !/^[a-f0-9]{24}$/.test(input.id) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80 ||
    typeof input.enabled !== "boolean" ||
    !HANDLERS.includes(input.handler)
  )
    throw fault("twitch_automation_invalid");
  const trigger = input.trigger;
  if (
    !closed(trigger, [
      "type",
      "rewardId",
      "command",
      "aliases",
      "keywords",
      "event",
      "intervalMs",
      "calendarMonths",
      "nextAt",
      "calendarDay",
      "repeatLimit",
      "onlyLive",
      "minMessages",
    ]) ||
    !["reward", "command", "timer", "event"].includes(trigger.type)
  )
    throw fault("twitch_automation_trigger_invalid");
  let clean;
  if (trigger.type === "reward") {
    if (
      !closed(trigger, ["type", "rewardId"]) ||
      trigger.command !== undefined ||
      typeof trigger.rewardId !== "string" ||
      trigger.rewardId.length > 160
    )
      throw fault("twitch_automation_trigger_invalid");
    clean = { type: "reward", rewardId: trigger.rewardId };
  } else if (trigger.type === "command") {
    if (
      !closed(trigger, ["type", "command", "aliases", "keywords", "onlyLive"]) ||
      trigger.rewardId !== undefined ||
      typeof trigger.command !== "string" ||
      !/^![a-z0-9][a-z0-9_]{0,39}$/.test(trigger.command) ||
      COMMAND_ALIASES.has(trigger.command.slice(1)) ||
      ["!clip", "!command"].includes(trigger.command) ||
      input.handler !== "flow"
    )
      throw fault("twitch_automation_command_reserved");
    clean = require("./command-triggers").normalize(trigger);
  } else if (trigger.type === "event") {
    if (
      !closed(trigger, ["type", "event"]) ||
      !require("../../capabilities/feature-platform/providers/twitch-automation-events").EVENTS.some(
        (row) => row[0] === trigger.event,
      ) ||
      input.handler !== "flow"
    )
      throw fault("twitch_automation_trigger_invalid");
    clean = { type: "event", event: trigger.event };
  } else {
    clean = require("./twitch-timer-config")(trigger, input.handler);
  }
  const cooldownSeconds = input.cooldownSeconds ?? 30,
    role = input.role ?? "moderator";
  if (
    !Number.isInteger(cooldownSeconds) ||
    cooldownSeconds < 0 ||
    cooldownSeconds > 86400 ||
    !Number.isInteger(input.userCooldownSeconds ?? 15) ||
    (input.userCooldownSeconds ?? 15) < 0 ||
    (input.userCooldownSeconds ?? 15) > 86400 ||
    !["viewer", "subscriber", "vip", "moderator", "broadcaster"].includes(role)
  )
    throw fault("twitch_automation_permissions_invalid");
  const flow = steps(
    canonicalize
      ? require("./command-source-fields").messages(
          require("../../shared/fs/migrate-action-references")(input.steps || []),
        )
      : input.steps || [],
  );
  if (input.handler === "flow" && input.enabled && !flow.length)
    throw fault("twitch_automation_flow_empty");
  return {
    id: input.id,
    accountId,
    name: input.name.trim(),
    enabled: input.enabled,
    trigger: clean,
    handler: input.handler,
    steps: flow,
    cooldownSeconds,
    userCooldownSeconds: input.userCooldownSeconds ?? 15,
    role,
  };
}
module.exports = { normalize, HANDLERS };
