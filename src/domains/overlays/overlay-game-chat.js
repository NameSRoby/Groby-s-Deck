/** Twitch chat uses the same saved game owner as OBS and local controls. */
const path = require("node:path");
const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
const { roleFromEvent } = require("../../shared/security/twitch-chat-role");
const { markTypes } = require("../../../public/core/overlay-game-rules");

const roles = ["moderator", "vip", "viewer"];
const boards = [...markTypes, "tile-match"];
const commands = {
  complete: { usage: "!complete <square name or number>", types: markTypes, operation: "complete" },
  uncomplete: {
    usage: "!uncomplete <square name or number>",
    types: markTypes,
    operation: "uncomplete",
  },
  flip: { usage: "!flip <tile number>", types: ["tile-match"], operation: "flip" },
  spin: { usage: "!spin", types: ["wheel"], operation: "spin" },
  openentries: { usage: "!openentries", types: ["wheel"], operation: "collect" },
  closeentries: { usage: "!closeentries", types: ["wheel"], operation: "close-entries" },
  openvotes: { usage: "!openvotes", types: ["chat-vote"], operation: "start" },
  closevotes: { usage: "!closevotes", types: ["chat-vote"], operation: "close" },
  cast_vote: { usage: "Vote (game’s chat command)", types: ["chat-vote"], public: true },
  join_wheel: { usage: "Join (wheel’s chat command)", types: ["wheel"], public: true },
  gamestatus: { usage: "!gamestatus", public: true },
  gamecommands: { usage: "!gamecommands", public: true },
};
const key = (row) => row.documentId + "/" + row.widgetId;
const name = (value) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const clean = (value) =>
  String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 420);
const supports = (command, widget) =>
  (!command.types || command.types.includes(widget.type)) &&
  (!requiresChatEntries(command) || widget.entrySource === "chat");
const requiresChatEntries = (command) =>
  command === commands.join_wheel || ["collect", "close-entries"].includes(command.operation);
const usage = (command, widget) =>
  command === commands.cast_vote
    ? widget.votePrefix + " <choice number>"
    : command === commands.join_wheel
      ? widget.joinCommand
      : command.usage;

function normalizePermissions(input) {
  return Object.fromEntries(
    Object.entries(commands).map(([id, command]) => [
      id,
      roles.filter((role) =>
        typeof input?.[id]?.[role] === "boolean"
          ? input[id][role]
          : command.public || role === "moderator",
      ),
    ]),
  );
}

module.exports = ({ runtimeDir, documents, games, changed, now = Date.now }) => {
  const file = path.join(runtimeDir, "system", "overlay-game-chat.json");
  const saved = readJsonFile(file, null);
  let config = {
    revision: Number.isSafeInteger(saved?.revision) ? saved.revision : 0,
    enabled: saved?.enabled === true,
    target: typeof saved?.target === "string" ? saved.target : "",
    owner: /^\d{1,80}$/.test(saved?.owner || "") ? saved.owner : "",
    permissions: normalizePermissions(saved?.permissions),
  };
  const recent = new Map();
  const actors = new Map();
  const related = () =>
    documents().flatMap((doc) =>
      doc.widgets
        .filter((widget) => widget.visible)
        .map((widget) => ({
          doc,
          widget,
          documentId: doc.id,
          widgetId: widget.id,
        })),
    );
  const selected = () => related().find((row) => key(row) === config.target);

  function status(owner) {
    const target = selected();
    return {
      revision: config.revision,
      enabled: config.enabled,
      active: Boolean(config.enabled && owner && config.owner === owner && target),
      target: config.target,
      roles,
      commands: Object.entries(commands).map(([id, command]) => ({
        id,
        usage: command.usage,
        types: command.types || [],
        requiresChatEntries: requiresChatEntries(command),
        roles: config.permissions[id],
      })),
      games: related().map((row) => ({
        id: key(row),
        label: row.doc.name + " / " + row.widget.name,
        type: row.widget.type,
        entryCommand:
          row.widget.type === "chat-vote"
            ? row.widget.votePrefix + " <choice number>"
            : row.widget.type === "wheel" && row.widget.entrySource === "chat"
              ? row.widget.joinCommand
              : "",
      })),
    };
  }

  function configure(input, owner) {
    if (input?.revision !== config.revision)
      throw Error("Game commands changed. Reopen the panel.");
    if (typeof input.enabled !== "boolean" || typeof input.target !== "string")
      throw Error("Choose a saved game and command permissions.");
    if (input.enabled && (!owner || !related().some((row) => key(row) === input.target)))
      throw Error("Connect Twitch with Read chat commands and choose a visible saved game.");
    const permissions = normalizePermissions(input.permissions);
    const next = {
      revision: config.revision + 1,
      enabled: input.enabled,
      target: related().some((row) => key(row) === input.target) ? input.target : "",
      owner: input.enabled ? owner : "",
      permissions,
    };
    const preferences = Object.fromEntries(
      Object.entries(permissions).map(([id, allowed]) => [
        id,
        Object.fromEntries(roles.map((role) => [role, allowed.includes(role)])),
      ]),
    );
    writeJsonFile(file, { ...next, permissions: preferences }, { mode: 0o600 });
    config = next;
    changed();
    return status(owner);
  }

  function square(board, input, numericOnly) {
    if (/^#?[1-9]\d{0,4}$/.test(input)) {
      const value = Number(input.replace(/^#/, ""));
      if (board.cells[value - 1]) return value;
    }
    if (!input || numericOnly) throw Error("Enter a tile number from the board.");
    const needle = name(input);
    const matches = board.cells.flatMap((cell, i) => (name(cell.text) === needle ? [i + 1] : []));
    if (matches.length > 1)
      throw Error("More than one square has that name. Use its square number.");
    if (!matches.length) throw Error("Square not found. Use its exact name or number.");
    return matches[0];
  }

  function execute(id, command, target, input, owner, allowed) {
    const { doc, widget } = target;
    const board = boards.includes(widget.type) ? games.board(doc, widget) : null;
    if (id === "gamecommands")
      return Object.entries(commands)
        .filter(([name, row]) => supports(row, widget) && allowed(name))
        .map(([, row]) => usage(row, widget))
        .join(" · ");
    if (id === "gamestatus") {
      if (!board) return widget.name + " is the active game.";
      const completed = board.cells.filter((cell) => cell.marked && !cell.free).length;
      return (
        widget.name +
        " — " +
        (board.operation === "flip"
          ? board.matched + " pairs matched"
          : completed +
            "/" +
            board.cells.filter((cell) => !cell.free).length +
            " squares complete") +
        (board.won ? (widget.type === "bingo" ? ". Bingo!" : ". Board complete!") : ".")
      );
    }
    const requiresSquare = ["complete", "uncomplete", "flip"].includes(id);
    const cell = requiresSquare ? square(board, input, id === "flip") : undefined;
    if (!requiresSquare && input) throw Error("Use " + command.usage + " without arguments.");
    const result = games.control(doc.id, widget.id, command.operation, { cell }, owner);
    if (id === "flip") return "Flipped tile " + cell + ".";
    if (!requiresSquare)
      return (
        widget.name +
        " — " +
        {
          spin: "wheel spinning",
          openentries: "entries open",
          closeentries: "entries closed",
          openvotes: "voting open",
          closevotes: "voting closed",
        }[id] +
        "."
      );
    return (
      board.cells[cell - 1].text +
      (result.unchanged
        ? id === "complete"
          ? " is already complete."
          : " is already open."
        : id === "complete"
          ? " completed."
          : " reopened.")
    );
  }

  async function handle(event, provider) {
    if (!config.enabled) return;
    const text = String(event?.message?.text || "").trim();
    const match = /^!([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text);
    const id = match?.[1].toLowerCase();
    if (!Object.hasOwn(commands, id)) return;
    const status = provider.status();
    const actor = event.chatter_user_id;
    const messageId = event.message_id;
    const owner = status.userId;
    if (
      !status.connected ||
      !status.scopes.includes("user:read:chat") ||
      owner !== config.owner ||
      event.broadcaster_user_id !== owner ||
      (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== owner) ||
      !/^\d{1,80}$/.test(actor || "") ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(messageId || "")
    )
      return;
    const target = selected();
    if (!target || !supports(commands[id], target.widget)) return;
    const reply = { handled: true, accepted: false };
    const role = roleFromEvent(event);
    const allowed = (name) => actor === owner || config.permissions[name].includes(role);
    if (!allowed(id) || recent.has(messageId)) return reply;
    const at = now();
    if ((actors.get(actor) || 0) > at) return reply;
    recent.set(messageId, true);
    actors.delete(actor);
    actors.set(actor, at + 1000);
    for (const history of [actors, recent])
      if (history.size > 2048) history.delete(history.keys().next().value);
    let message;
    try {
      message = execute(id, commands[id], target, match[2]?.trim() || "", owner, allowed);
      reply.accepted = true;
    } catch (error) {
      message = error.message;
    }
    if (status.scopes.includes("user:write:chat"))
      await provider
        .sendChat({ message: clean(message), replyParentMessageId: messageId })
        .catch(() => {});
    return reply;
  }
  function allowsParticipation(doc, widget, event, owner) {
    if (!config.enabled || config.owner !== owner || config.target !== doc.id + "/" + widget.id)
      return true;
    if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== owner)
      return false;
    const id = widget.type === "wheel" ? "join_wheel" : "cast_vote";
    return event.chatter_user_id === owner || config.permissions[id].includes(roleFromEvent(event));
  }
  return {
    configure,
    status,
    handle,
    allowsParticipation,
    interested: (owner) => Boolean(owner && owner === config.owner && config.enabled && selected()),
  };
};
