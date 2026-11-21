/** Public command documentation only: never evaluates replies or reads action parameters. */
(function (root) {
  const roles = {
    viewer: "Everyone",
    subscriber: "Subscribers+",
    vip: "VIPs+",
    moderator: "Moderators+",
    broadcaster: "Broadcaster only",
  };
  const clean = (value, max = 800) =>
    String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
      .slice(0, max);
  function commands(rows) {
    return rows
      .filter((row) => row.trigger?.type === "command")
      .map((row) => ({
        id: row.id,
        command: clean(row.trigger.command, 80),
        usage: clean(row.trigger.command, 160),
        aliases: (row.trigger.aliases || []).map((value) => clean(value, 80)),
        phrases: (row.trigger.keywords || []).map((value) => clean(value, 160)),
        description: row.name !== row.trigger.command ? clean(row.name) : "",
        role: roles[row.role] || "Check access",
        enabled: !!row.enabled,
        cooldown: Number(row.cooldownSeconds) || 0,
        userCooldown: Number(row.userCooldownSeconds) || 0,
        source: "Saved command",
        included: false,
      }))
      .sort((a, b) =>
        a.command.localeCompare(b.command, undefined, { numeric: true, sensitivity: "base" }),
      );
  }
  function builtins() {
    return [
      ["!title", "!title new stream title", "Change the stream title.", "moderator"],
      [
        "!category",
        "!category category name",
        "Find the closest matching Twitch category and switch to it.",
        "moderator",
        ["!setgame"],
      ],
      [
        "!followage",
        "!followage [name]",
        "Show how long you or another person have followed.",
        "viewer",
      ],
      ["!watchtime", "!watchtime [name]", "Show estimated tracked watchtime.", "viewer"],
      ["!points", "!points [name]", "Show tracked loyalty points.", "viewer"],
      ["!quote", "!quote [number]", "Read a random quote or choose its number.", "viewer"],
      ["!quote add", "!quote add quote text", "Add a quote.", "moderator"],
      [
        "!deletequote",
        "!deletequote number",
        "Delete a quote and renumber the remaining list.",
        "moderator",
      ],
      [
        "!command add",
        "!command add name reply",
        "Create a chat reply; variables are supported.",
        "moderator",
      ],
      [
        "!command edit",
        "!command edit name replacement reply",
        "Replace a saved command reply.",
        "moderator",
      ],
      ["!command delete", "!command delete name", "Remove a saved chat command.", "moderator"],
    ].map(([command, usage, description, role, aliases = []]) => ({
      id: "builtin:" + command,
      command,
      usage,
      description,
      role: roles[role],
      aliases,
      phrases: [],
      enabled: true,
      source: "Built-in",
      included: false,
    }));
  }
  function escape(value, format) {
    let text = clean(value, Infinity).replace(/[\\`*_{}\[\]()#+.|>~-]/g, "\\$&");
    if (format === "discord") text = text.replaceAll("@", "@\u200b").replaceAll("<", "\\<");
    else text = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return text;
  }
  const duration = (seconds) =>
    seconds >= 3600 && seconds % 3600 === 0
      ? seconds / 3600 + "h"
      : seconds >= 60 && seconds % 60 === 0
        ? seconds / 60 + "m"
        : seconds + "s";
  function generate(rows, options = {}) {
    const format = options.format || "discord",
      limit =
        format === "discord"
          ? options.limit === 4000
            ? 4000
            : 2000
          : Math.max(1000, Math.min(10000, Number(options.limit) || 2000));
    const title = escape(clean(options.title, 100), format);
    const heading = title ? "**" + title + "**\n\n" : "";
    const selected = rows.filter((row) => row.included);
    if (format === "discord" && options.style === "boxed") {
      const parts = [];
      let current = heading;
      const append = (entry) => {
        const separator = current === heading ? "" : "\n\n";
        if (current.length + separator.length + entry.length > limit && current !== heading) {
          parts.push(current.trimEnd());
          current = heading;
        }
        current += (current === heading ? "" : "\n\n") + entry;
      };
      for (const row of selected) {
        // Discord's copy control copies this block alone; usage stays directly pasteable.
        const command = clean(row.usage || row.command, 160).replaceAll("`", "\u02cb"),
          box = "```text\n" + command + "\n```",
          lines = [];
        if (options.detail !== "compact" && row.description)
          lines.push(escape(row.description, format));
        if (options.examples && row.example)
          lines.push("Example reply: " + escape(row.example, format));
        if (options.aliases && row.aliases?.length)
          lines.push("Also: " + escape(row.aliases.join(", "), format));
        if (options.phrases && row.phrases?.length)
          lines.push("Triggers: " + escape(row.phrases.join(", "), format));
        const meta = [];
        if (options.access) meta.push(row.role);
        if (options.cooldowns && row.cooldown !== undefined)
          meta.push(
            "Cooldown " + duration(row.cooldown) + "; per person " + duration(row.userCooldown),
          );
        if (!row.enabled) meta.push("Paused");
        if (meta.length) lines.push(escape(meta.join(" | "), format));
        const tail = lines.length ? "\n" + lines.join("\n") : "",
          entry = box + tail;
        if (heading.length + entry.length <= limit) {
          append(entry);
          continue;
        }
        // Keep the command block intact. Only exceptionally long details continue in another part.
        const tokens = tail.match(/\\[\s\S]|[\s\S]/gu) || [];
        let cursor = 0,
          first = true;
        do {
          let fragment = first ? box : "";
          while (
            cursor < tokens.length &&
            heading.length + fragment.length + tokens[cursor].length <= limit
          )
            fragment += tokens[cursor++];
          append(fragment);
          first = false;
        } while (cursor < tokens.length);
      }
      if (selected.length) parts.push(current.trimEnd());
      return { parts, limit, count: selected.length };
    }
    const chunks = [];
    let current = heading;
    for (const row of selected) {
      let description = options.detail === "compact" ? "" : clean(row.description);
      const meta = [];
      if (options.access) meta.push(row.role);
      if (options.cooldowns && row.cooldown !== undefined)
        meta.push(
          "Cooldown " + duration(row.cooldown) + "; per person " + duration(row.userCooldown),
        );
      if (!row.enabled) meta.push("Paused");
      const names = [row.usage || row.command];
      if (options.aliases && row.aliases?.length) names.push("Also: " + row.aliases.join(", "));
      if (options.phrases && row.phrases?.length)
        names.push("Exact phrases: " + row.phrases.join(", "));
      const prefix = "* **" + escape(clean(names[0], 160), format) + "**";
      let suffix =
        (description ? " - " + escape(description, format) : "") +
        (options.examples && row.example
          ? " - Example reply: " + escape(row.example, format)
          : "") +
        (names.length > 1 ? " (" + escape(names.slice(1).join("; "), format) + ")" : "") +
        (meta.length ? " [" + escape(meta.join("; "), format) + "]" : "");
      // Whole entries stay together; exceptionally long entries continue without dropping text.
      const tokens = suffix.match(/\\[\s\S]|&(?:amp|lt|gt);|[\s\S]/gu) || [];
      let first = true,
        cursor = 0;
      do {
        const lead = first ? prefix : prefix + " (continued)";
        const budget = limit - heading.length - lead.length - 4;
        let fragment = "";
        while (cursor < tokens.length && fragment.length + tokens[cursor].length <= budget)
          fragment += tokens[cursor++];
        const line = lead + fragment + (format === "twitch" ? "  \n" : "\n");
        if (current.length + line.length > limit && current !== heading) {
          chunks.push(current.trimEnd());
          current = heading;
        }
        current += line;
        first = false;
      } while (cursor < tokens.length);
    }
    if (selected.length) chunks.push(current.trimEnd());
    return { parts: chunks, limit, count: selected.length };
  }
  const api = { commands, builtins, generate, roles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CommandListModel = api;
})(globalThis);
