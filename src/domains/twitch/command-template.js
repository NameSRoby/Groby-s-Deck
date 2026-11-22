/** Bounded data templates. Inserted viewer text is never parsed as another function. */
const fail = (message) => {
  throw Object.assign(Error(message), { code: "twitch_template_invalid" });
};
function parse(source) {
  if (typeof source !== "string" || source.length > 16384) fail("Template is too long.");
  let count = 0;
  function walk(start, depth, closing) {
    // Public conditions are bounded by the compiler. Their VM expansion needs
    // room for local reads and arithmetic inside those conditions.
    if (depth > 12) fail("Command expressions are nested too deeply.");
    const nodes = [];
    let text = "",
      i = start;
    const flush = () => {
      if (text) {
        nodes.push(text);
        text = "";
      }
    };
    while (i < source.length) {
      if (source.startsWith("\\${", i)) {
        text += "${";
        i += 3;
        continue;
      }
      if (source.startsWith("${", i)) {
        flush();
        if (++count > 2048) fail("This command has too many compiled expressions.");
        const child = walk(i + 2, depth + 1, true);
        nodes.push({ parts: child.nodes });
        i = child.end;
        continue;
      }
      if (closing && source[i] === "}") {
        flush();
        return { nodes, end: i + 1 };
      }
      text += source[i++];
    }
    if (closing) fail("Close every function with }.");
    flush();
    return { nodes, end: i };
  }
  return walk(0, 0, false).nodes;
}
async function render(
  source,
  {
    context = {},
    lookup = async () => null,
    counter = () => 0,
    random = Math.random,
    now = Date.now,
    preview = false,
  } = {},
) {
  source = require("./command-variables").compile(source);
  const tree = parse(source),
    memo = new Map(),
    lookups = new Map();
  let operations = 0;
  const target = context.target || context.raider || context.user,
    channel = context.channel;
  const clean = (value) => {
    const name = String(value || "").replace(/^@/, "");
    if (!/^[a-z0-9_]{1,25}$/i.test(name)) fail("Choose a valid Twitch username.");
    return name.toLowerCase();
  };
  async function info(name) {
    name = clean(name);
    if (!lookups.has(name)) {
      if (lookups.size >= 5) fail("Use at most five channel lookups.");
      lookups.set(name, Promise.resolve(lookup(name)));
    }
    const value = await lookups.get(name);
    if (!value) fail("Channel details could not be confirmed.");
    return value;
  }
  const roll = () => {
    const n = random();
    if (!Number.isFinite(n) || n < 0 || n >= 1) fail("Random source unavailable.");
    return n;
  };
  const num = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || Math.abs(n) > 1000000000)
      fail("Use a whole number between -1000000000 and 1000000000.");
    return n;
  };
  const recipeFunction = require("./command-recipe-functions")({
    context,
    counter,
    preview,
    clean,
    num,
    fail,
  });
  async function nodes(items) {
    let output = "";
    for (const item of items) {
      output += typeof item === "string" ? item : await expression(item.parts);
      if (output.length > 4096) fail("Expanded message is too long.");
    }
    return output;
  }
  async function expression(parts) {
    if (++operations > 512) fail("Too many functions.");
    // Branch alternatives stay unevaluated until chosen: unused counters never change.
    const raw = parts[0];
    if (typeof raw === "string" && /^(if|chance|pick|weighted)\[/.test(raw)) {
      const name = raw.slice(0, raw.indexOf("[")),
        chunks = [[]];
      let first = true;
      for (const part of parts) {
        if (typeof part !== "string") {
          chunks.at(-1).push(part);
          continue;
        }
        let value = part;
        if (first) {
          value = value.slice(name.length + 1);
          first = false;
        }
        const segments = value.split("|");
        for (let i = 0; i < segments.length; i++) {
          if (i) chunks.push([]);
          chunks.at(-1).push(segments[i]);
        }
      }
      const last = chunks.at(-1);
      if (typeof last.at(-1) !== "string" || !last.at(-1).endsWith("]"))
        fail("Close each variable with } and put each choice in quotes.");
      last[last.length - 1] = last.at(-1).slice(0, -1);
      if (name === "if") {
        if (chunks.length !== 3) fail("Use ${if condition}, ${else} and ${end}.");
        const condition = Number(await nodes(chunks[0]));
        if (!Number.isFinite(condition)) fail("An if condition must be a number or calculation.");
        return nodes(chunks[condition !== 0 ? 1 : 2]);
      }
      if (name === "chance") {
        if (chunks.length !== 3) fail('Use ${chance 25 "You win!" "Try again"}.');
        const percent = Number(await nodes(chunks[0]));
        if (!Number.isFinite(percent) || percent < 0 || percent > 100)
          fail("Chance must be between 0 and 100.");
        return nodes(chunks[roll() * 100 < percent ? 1 : 2]);
      }
      if (chunks.length < 2 || chunks.length > 32) fail("Choose between 2 and 32 options.");
      if (name === "pick") return nodes(chunks[Math.floor(roll() * chunks.length)]);
      let total = 0;
      const choices = chunks.map((chunk) => {
        const text = chunk[0],
          match = typeof text === "string" && /^(\d+(?:\.\d+)?):/.exec(text);
        if (!match || Number(match[1]) <= 0) fail('Use ${weighted "1:Rare" "9:Common"}.');
        const weight = Number(match[1]);
        total += weight;
        return { weight, parts: [text.slice(match[0].length), ...chunk.slice(1)] };
      });
      if (!Number.isFinite(total) || total > 1000000) fail("Weights are too large.");
      let value = roll() * total;
      for (const choice of choices) {
        value -= choice.weight;
        if (value < 0) return nodes(choice.parts);
      }
      return nodes(choices.at(-1).parts);
    }
    const { rawExpression, structuredArgs } = await require("./command-template-arguments")(
      parts,
      expression,
      fail,
    );
    const expr = rawExpression,
      match = /^([a-z][a-z0-9.]*)(?:\[([\s\S]*)\])?$/i.exec(expr);
    if (/^\d{1,2}$/.test(expr)) {
      const index = Number(expr);
      if (index < 1 || index > 20) fail("Arguments are numbered 1 to 20.");
      return context.argv?.[index - 1] || "";
    }
    if (!match) fail("Check the function syntax: " + expr);
    const name = match[1].toLowerCase(),
      arg = structuredArgs ? structuredArgs.join("|") : (match[2] ?? match[3]),
      args = structuredArgs || arg?.split("|") || [];
    const recipeValue = await recipeFunction(name, arg, args);
    if (recipeValue !== undefined) return recipeValue;
    if (name === "args") {
      const start = arg === undefined ? 1 : num(arg);
      if (start < 1 || start > 20) fail("Arguments are numbered 1 to 20.");
      return (context.argv || []).slice(start - 1).join(" ");
    }
    if (["count", "getcount", "addcount", "setcount"].includes(name)) {
      const key = (args[0] || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(key))
        fail("Give the counter a name of up to 64 letters, digits, spaces, _ or -.");
      const mode =
          name === "count"
            ? "add"
            : name === "getcount"
              ? "get"
              : name === "addcount"
                ? "add"
                : "set",
        amount = name === "count" ? 1 : name === "getcount" ? 0 : num(args[1]);
      const keyMemo = name + ":" + key + ":" + amount;
      if (name !== "count") return String(await counter(key, mode, amount, preview));
      if (!memo.has(keyMemo)) memo.set(keyMemo, String(await counter(key, mode, amount, preview)));
      return memo.get(keyMemo);
    }
    if (name === "random") {
      if (args.length !== 2) fail("Use ${random 1 20}, changing 1 and 20 for your range.");
      const min = num(args[0]),
        max = num(args[1]);
      if (max < min) fail("Maximum must be at least minimum.");
      return String(min + Math.floor(roll() * (max - min + 1)));
    }
    if (
      ["game", "title", "link", "uptime", "live"].includes(name) ||
      (name === "viewers" && context.event !== "channel.raid")
    ) {
      const field = name.split(".").at(-1),
        who = arg || channel;
      if (field === "link") return "https://www.twitch.tv/" + clean(who);
      const row = await info(who);
      if (field === "uptime")
        return row.live
          ? Math.max(0, Math.floor((now() - row.startedAt) / 60000)) + " minutes"
          : "offline";
      return String(row[field] ?? "");
    }
    if (name === "time") return new Date(now()).toISOString().slice(11, 19) + " UTC";
    if (name === "date") return new Date(now()).toISOString().slice(0, 10);
    if (name === "unix") return String(Math.floor(now() / 1000));
    const values = { ...context, sender: context.sender || context.user, user: target };
    if (
      arg === undefined &&
      [
        "sender",
        "user",
        "channel",
        "command",
        "role",
        "raider",
        "viewers",
        "bits",
        "months",
        "gifts",
        "event",
      ].includes(name)
    ) {
      const value = values[name];
      if (value === undefined || value === "") fail("This trigger has no " + name + " value.");
      return String(value);
    }
    fail("Unknown function: " + name);
  }
  const output = (await nodes(tree)).replace(/\s+/g, " ").trim();
  if (output.length > 500) fail("Chat output exceeds 500 characters.");
  return output;
}
module.exports = {
  parse,
  render,
};
