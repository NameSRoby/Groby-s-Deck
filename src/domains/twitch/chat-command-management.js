/** Moderator-authored chat replies share the automation store, permissions and revision checks. */
const crypto = require("node:crypto");
const RESERVED = new Set([
  "command",
  "clip",
  "title",
  "category",
  "setgame",
  "followage",
  "watchtime",
  "points",
  "quote",
  "deletequote",
]);
module.exports =
  ({ status, save, remove }) =>
  async ({ text, broadcaster }) => {
    const match =
      /^!command\s+(add|edit|delete)\s+(!?[a-z0-9][a-z0-9_]{0,39})(?:\s+([\s\S]*))?$/i.exec(
        text.trim(),
      );
    if (!match)
      throw Error(
        "Use !command add name reply, !command edit name reply, or !command delete name.",
      );
    const operation = match[1].toLowerCase(),
      command = "!" + match[2].replace(/^!/, "").toLowerCase(),
      message = (match[3] || "").trim();
    if (
      RESERVED.has(command.slice(1)) ||
      require("../../capabilities/feature-platform/providers/twitch-chat-command-router").COMMAND_ALIASES.has(
        command.slice(1),
      )
    )
      throw Error(command + " is a built-in command. Manage its settings in the app.");
    if (operation === "delete" && message)
      throw Error("Use !command delete " + command + " without a reply.");
    if (operation !== "delete" && !message)
      throw Error("Add the reply after " + command + ". Variables are supported.");
    const snapshot = status(),
      existing = snapshot.rows.find(
        (row) => row.trigger.type === "command" && row.trigger.command === command,
      );
    if (operation === "add" && existing)
      throw Error(command + " already exists. Use !command edit.");
    if (operation !== "add" && !existing)
      throw Error(command + " does not exist. Use !command add.");
    if (existing?.role === "broadcaster" && !broadcaster)
      throw Error("Only the broadcaster can change this command.");
    if (operation === "delete") {
      await remove({ revision: snapshot.revision, id: existing.id });
      return command + " deleted.";
    }
    if (
      existing &&
      (existing.handler !== "flow" ||
        existing.steps.length !== 1 ||
        existing.steps[0].actionId !== "twitch.action.chat")
    )
      throw Error(
        "This command has a custom flow. Edit it in Rewards & automations to preserve its actions.",
      );
    const canonical = require("./command-source").canonical(message),
      compiled = require("./command-variables").compile(canonical);
    require("./command-template").parse(compiled);
    const automation = existing
      ? structuredClone(existing)
      : {
          id: crypto.randomBytes(12).toString("hex"),
          name: command,
          enabled: true,
          trigger: { type: "command", command, onlyLive: false },
          handler: "flow",
          steps: [],
          role: "viewer",
          cooldownSeconds: 5,
          userCooldownSeconds: 15,
        };
    automation.steps = [
      {
        ...(automation.steps[0] || {}),
        actionId: "twitch.action.chat",
        params: { message: canonical },
      },
    ];
    await save({ revision: snapshot.revision, automation });
    return (
      command +
      (operation === "add"
        ? " added. Everyone can use it."
        : " updated; access and cooldowns kept.")
    );
  };
