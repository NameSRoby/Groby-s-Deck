/** Convert public custom-command exports. No account-specific examples belong here. */
const crypto = require("node:crypto"),
  { parse } = require("./command-template");
function convert(source, command) {
  source = source.replace(/\$\(count\)/g, "${count " + command + "}");
  function nodes(items) {
    return items.map((item) => (typeof item === "string" ? item : expression(item.parts))).join("");
  }
  function expression(parts) {
    const text = nodes(parts).trim();
    let match;
    if ((match = /^count\s+([a-z0-9_-]+)(?:\s+(-?\d+))?$/i.exec(text))) {
      return (
        "${" +
        (match[2] === undefined
          ? `count${match[1]}`
          : Number(match[2]) === 0
            ? `resetcount${match[1]}`
            : `addcount ${match[1]} ${match[2]}`) +
        "}"
      );
    }
    if ((match = /^random\.(-?\d+)-(-?\d+)$/.exec(text)))
      return "${random." + match[1] + "-" + match[2] + "}";
    if (text.startsWith("random.pick ")) {
      const choices = [],
        tail = text.slice(12),
        pattern = /'([^']*)'|"([^"]*)"/g;
      let end = 0,
        found;
      while ((found = pattern.exec(tail))) {
        if (tail.slice(end, found.index).trim()) throw Error("Review the random choices.");
        const choice = found[1] ?? found[2];
        if (parse(choice).some((part) => typeof part === "string" && part.includes("|")))
          throw Error("Review a choice containing a separator.");
        choices.push(choice);
        end = pattern.lastIndex;
      }
      if (tail.slice(end).trim() || choices.length < 2) throw Error("Review the random choices.");
      return "${random.pick " + choices.map((choice) => JSON.stringify(choice)).join(" ") + "}";
    }
    if ((match = /^(game|title)\s+\$\{1\}$/.exec(text))) return "${" + match[1] + " user}";
    if (text === "channel ${1}") return "${user}";
    if (/^(sender|user|target|channel|game|title|args|[1-9]|1\d|20)$/.test(text))
      return "${" + text + "}";
    throw Error("Review unsupported function: " + text.slice(0, 80));
  }
  return require("./command-source").canonical(nodes(parse(source)));
}
function prepare(commands) {
  if (!Array.isArray(commands) || commands.length > 128)
    throw Error("Invalid custom-command export.");
  return commands.map((command) => {
    const name = String(command.command || "").toLowerCase(),
      notes = [];
    const roles = {
      100: "viewer",
      250: "subscriber",
      300: "vip",
      400: "vip",
      500: "moderator",
      1000: "broadcaster",
      1500: "broadcaster",
    };
    if (!roles[command.accessLevel]) throw Error("Unknown access level for " + name);
    if ([300, 1000].includes(command.accessLevel))
      notes.push("Mapped legacy role to " + roles[command.accessLevel]);
    let message =
      name === "fight"
        ? require("./command-arena-variables").message
        : name === "so"
          ? "Go follow ${user}! Thanks for the support. They were playing ${game user}: ${link user}"
          : convert(String(command.reply || ""), name);
    if (command.type === "mention") message = "@${sender} " + message;
    const announcement = message.startsWith("/announce ");
    if (announcement) {
      message = message.slice(10);
      notes.push("Uses the native announcement action; requires announcement access.");
    }
    if (name === "fight")
      notes.push(
        "Replaced with the fully editable arena recipe; remains disabled as in the export.",
      );
    const aliases = [
      ...new Set(
        (command.aliases || [])
          .map((word) => "!" + word.trim().toLowerCase())
          .filter((word) => word !== "!" + name),
      ),
    ];
    const keywords = [
      ...new Set((command.keywords || []).map((word) => word.trim().toLowerCase()).filter(Boolean)),
    ];
    const automation = {
      id: crypto
        .createHash("sha256")
        .update("custom-command-import:" + name)
        .digest("hex")
        .slice(0, 24),
      name: "!" + name,
      enabled: command.enabled === true,
      trigger: {
        type: "command",
        command: "!" + name,
        ...(aliases.length ? { aliases } : {}),
        ...(keywords.length ? { keywords } : {}),
      },
      handler: "flow",
      steps: [
        {
          actionId: announcement ? "twitch.action.announcement" : "twitch.action.chat",
          params: { message },
        },
      ],
      role: roles[command.accessLevel],
      cooldownSeconds: command.cooldown?.global ?? 5,
      userCooldownSeconds: command.cooldown?.user ?? 15,
    };
    return { automation, notes };
  });
}
module.exports = { convert, prepare };
