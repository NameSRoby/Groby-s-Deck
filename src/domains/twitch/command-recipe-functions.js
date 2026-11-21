/** Generic values, arithmetic and player records shared by editable recipes. */
module.exports = ({ context, counter, preview, clean, num, fail }) => {
  const locals = new Map();
  return async (name, arg, args) => {
    if (name === "username") {
      if (args.length !== 1) fail("Use ${username 1} or ${username sender}.");
      const input = String(args[0]).trim().replace(/^@/, "");
      const invalid = (code, message) => {
        throw Object.assign(Error(message), { code });
      };
      if (!input)
        invalid(
          "twitch_command_target_required",
          "Provide a Twitch username after the command, with or without @.",
        );
      if (!/^[a-z0-9_]{1,25}$/i.test(input))
        invalid(
          "twitch_command_target_invalid",
          "Use a username made of letters, numbers and underscores.",
        );
      return clean(input);
    }
    if (name === "same") {
      if (args.length !== 2) fail("Use ${same first second} to compare two values.");
      const normalized = (value) => String(value).trim().replace(/^@/, "").toLowerCase();
      return String(Number(normalized(args[0]) === normalized(args[1])));
    }
    if (name === "literal") {
      if (args.length !== 1) fail("Invalid literal text.");
      try {
        return decodeURIComponent(args[0]);
      } catch {
        fail("Invalid literal text.");
      }
    }
    if (name === "calc") return String(require("./command-math")(arg || ""));
    if (name === "set" || name === "get") {
      const key = args[0];
      if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key || "")) fail("Give this value a short name.");
      if (name === "get") {
        if (!locals.has(key)) fail("Remember " + key + " before using it.");
        return locals.get(key);
      }
      if (args.length !== 2) fail("Use ${set name value}.");
      locals.set(key, args[1]);
      return "";
    }
    if (["stat", "addstat", "setstat"].includes(name)) {
      const player = clean(args[0]),
        field = args[1];
      if (!/^[a-z][a-z0-9_]{0,23}$/i.test(field || ""))
        fail("Give the player record a short field name.");
      const key = "player " + player + " " + field.toLowerCase();
      if (name === "stat") {
        const value = await counter(key, "get", 0, preview);
        return String(
          args[2] !== undefined && counter.has && !counter.has(key) ? num(args[2]) : value,
        );
      }
      if (args.length !== 3)
        fail("Use ${addstat player field amount} or ${setstat player field value}.");
      await counter(key, name === "addstat" ? "add" : "set", num(args[2]), preview);
      return "";
    }
    if (name === "top") {
      if (!/^[a-z][a-z0-9_]{0,23}$/i.test(args[0] || "")) fail("Choose a player record field.");
      const limit = args[1] === undefined ? 5 : num(args[1]);
      if (limit < 1 || limit > 10) fail("Show between 1 and 10 players.");
      return counter.top?.(args[0].toLowerCase(), limit) || "No player records yet.";
    }
    if (name === "resetstats") {
      if (args.length !== 2 || !/^[a-z][a-z0-9_]{0,23}$/i.test(args[0]) || !counter.resetField)
        fail("Use ${resetstats field}, optionally followed by a starting number.");
      counter.resetField(args[0].toLowerCase(), num(args[1]));
      return "";
    }
    if (name === "saveboard" || name === "board") {
      const label = args[0] || "";
      if (!/^[a-z0-9][a-z0-9 _-]{0,63}$/i.test(label))
        fail("Give the saved leaderboard a name of up to 64 letters, digits, spaces, _ or -.");
      if (name === "board") {
        if (args.length !== 1 || !counter.board) fail("Use ${board name}.");
        return counter.board(label);
      }
      const limit = num(args[2]);
      if (
        args.length !== 3 ||
        !/^[a-z][a-z0-9_]{0,23}$/i.test(args[1]) ||
        limit < 1 ||
        limit > 10 ||
        !counter.saveBoard
      )
        fail("Use ${saveboard name field count}, choosing 1-10 people.");
      counter.saveBoard(label, args[1].toLowerCase(), limit);
      return "";
    }
    if (name === "boards") {
      const limit = num(args[0]);
      if (args.length !== 1 || limit < 1 || limit > 10 || !counter.boards)
        fail("Use ${boards}, or ${boards 5} for the last five saved leaderboards.");
      return counter.boards(limit);
    }
  };
};
