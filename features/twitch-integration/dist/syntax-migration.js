"use strict";
/** Convert authored templates once; compiled VM instructions are not public syntax. */
function modernize(source) {
  source = source.replace(
    /(?<![$\\])\{(user|raider|viewers|bits|months|gifts|event)\}/g,
    (_, key) => "${" + key + "}",
  );
  const quote = (value) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const argument = (value) => (/^[a-z0-9_.+-]+$/i.test(value) ? value : quote(value));
  const split = require("./variable-arguments");
  const arena = () => require("./arena-language.json");
  if (
    [
      "a65f7d03648920736ea7133d59819c6d88512e8183a4b524430c6fc07c962f7a",
      "f4ab53135ec52d4067dacf41a073ad2b27a8b8786e313a97e09eb9491b2734eb",
    ].includes(require("node:crypto").createHash("sha256").update(source).digest("hex"))
  )
    return arena().message;
  let usesDuel = 0,
    firstDuel;
  function duel(name, parts = []) {
    if (name === "fightstats") {
      const who = parts[0] ? walk(parts[0]) : "user";
      return (
        "${set recordUser " +
        who +
        "}${set recordXP stat recordUser xp}${set recordLevel floor(recordXP / 100) + 1}${recordUser}: ${stat recordUser wins} wins / ${stat recordUser losses} losses. Level ${recordLevel}; XP ${recordXP}; Rating ${stat recordUser rating 1000}; Streak ${stat recordUser streak}"
      );
    }
    if (name === "fighttop") return "${top wins 5}";
    usesDuel++;
    const recipe = arena(),
      rules = recipe.stages
        .slice(0, 8)
        .map((stage) => stage.source)
        .join("\n");
    if (parts[0] && !["${1}", "${user}", "${target}"].includes(parts[0]))
      throw Error("Use the editable arena recipe to choose this fight's player.");
    const fields = {
      "fight.roll": "${roll}",
      "fight.dc": "${difficulty}",
      "fight.chance": "${chance}",
      "fight.winner": "${winner}",
      "fight.loser": "${loser}",
      "fight.outcome":
        "${if roll == 1}Critical failure${else}${if roll == 20}Critical hit${else}${if won == 1}Victory${else}Defeat${end}${end}${end}",
      "fight.story": recipe.stages
        .slice(10, 14)
        .map((stage) => stage.source)
        .join("\n"),
      fight: recipe.stages
        .slice(8)
        .map((stage) => stage.source)
        .join("\n"),
    };
    if (!Object.hasOwn(fields, name)) throw Error("Unknown old fight field: " + name);
    let story = fields[name];
    if (name === "fight" && parts[1] !== undefined) {
      if (!/^[a-z0-9_]{0,32}$/i.test(parts[1])) throw Error("Choose a single emote name.");
      story = story.replace(/\bDeath\b/g, parts[1]);
    }
    const guarded = "${if migratedDuel == 0}${set migratedDuel 1}" + rules + "${end}" + story;
    firstDuel ||= { guarded, plain: rules + story };
    return guarded;
  }
  function expression(body) {
    body = body.trim();
    if (body === "target") return "${user}";
    if (body === "opponent") return "${username 1}";
    const targetField = /^target\.(game|title|link|live|uptime)$/.exec(body);
    if (targetField) return "${" + targetField[1] + " user}";
    const range = /^random\.(-?\d+)-(-?\d+)$/.exec(body);
    if (range) return "${random " + range[1] + " " + range[2] + "}";
    if (body === "random") return "${random 1 100}";
    if (/^(fight(?:\.[a-z]+)?|fightstats|fighttop)$/.test(body)) return duel(body);
    if (body.startsWith("if ")) {
      const options = split(body.slice(3));
      const quoted = (value) => /^["']/.test(value || "");
      if (options[0] !== "same" && quoted(options.at(-1))) {
        const last = options.pop(),
          hasNo = quoted(options.at(-1));
        const yes = hasNo ? options.pop() : last,
          no = hasNo ? last : '""';
        const unquote = (value) => value.slice(1, -1).replace(/\\(["'\\])/g, "$1");
        return (
          "${if " +
          walk(options.join(" ")) +
          "}" +
          walk(unquote(yes)) +
          "${else}" +
          walk(unquote(no)) +
          "${end}"
        );
      }
    }
    const oldCounter = /^(count|getcount)\s+([a-z0-9][a-z0-9 _-]{0,63})$/i.exec(body);
    if (oldCounter) {
      const [, operation, key] = oldCounter;
      return (
        "${" + (operation.toLowerCase() === "getcount" ? "readcount" : "count") + key.trim() + "}"
      );
    }
    const match = /^([a-z][a-z0-9.]*)\[([\s\S]*)\]$/i.exec(body);
    if (!match) {
      const parts = split(body),
        name = parts.shift();
      if (name === "get" && parts.length === 1) return "${" + parts[0] + "}";
      if (name === "calc") return "${math " + walk(parts.join(" ")) + "}";
      if (name === "pick") return "${random.pick " + parts.map(walk).join(" ") + "}";
      if (name === "setcount" && parts.length === 2 && parts[1] === "0") {
        const key = parts[0].replace(/^(["'])(.*)\1$/, "$2");
        if (/^[a-z0-9][a-z0-9 _-]{0,63}$/i.test(key)) return "${resetcount" + key + "}";
      }
      if (name === "set" && parts[1] === "opponent") parts.splice(1, 1, "username", "1");
      for (let index = name === "set" ? 1 : 0; index < parts.length; index++)
        if (parts[index] === "target") parts[index] = "user";
        else if (parts[index] === "opponent") parts[index] = "username 1";
        else if (/^random\.(-?\d+)-(-?\d+)$/.test(parts[index]))
          parts[index] = parts[index].replace(/^random\.(-?\d+)-(-?\d+)$/, "random $1 $2");
        else if (/^target\.(game|title|link|live|uptime)$/.test(parts[index]))
          parts[index] = parts[index].slice(7) + " user";
      return "${" + [name, ...parts.map(walk)].join(" ") + "}";
    }
    const name = match[1].toLowerCase(),
      parts = [""];
    let depth = 0;
    for (let i = 0; i < match[2].length; i++) {
      const ch = match[2][i];
      if (ch === "\\") {
        parts[parts.length - 1] += ch + (match[2][++i] || "");
        continue;
      }
      if (match[2].startsWith("${", i)) depth++;
      if (ch === "}" && depth) depth--;
      if (ch === "|" && !depth) parts.push("");
      else parts[parts.length - 1] += ch;
    }
    const values = parts.map(walk);
    if (/^(fight(?:\.[a-z]+)?|fightstats|fighttop)$/.test(name)) return duel(name, parts);
    if (["count", "getcount", "setcount", "addcount"].includes(name)) {
      const key = parts[0].trim();
      if (!/^[a-z0-9][a-z0-9 _-]{0,63}$/i.test(key))
        throw Error("Review this counter's name before converting it.");
      if (name === "count" && parts.length === 1) return "${count" + key + "}";
      if (name === "getcount" && parts.length === 1) return "${readcount" + key + "}";
      if (name === "setcount" && values[1] === "0") return "${resetcount" + key + "}";
      if (parts.length === 2)
        return "${" + name + " " + argument(key) + " " + argument(values[1]) + "}";
    }
    if (name === "random" && parts.length === 2) {
      return "${random " + values.map(argument).join(" ") + "}";
    }
    if (["pick", "chance", "weighted"].includes(name))
      return (
        "${" +
        (name === "pick" ? "random.pick" : name) +
        " " +
        values
          .map((value, index) => (name === "chance" && !index ? argument(value) : quote(value)))
          .join(" ") +
        "}"
      );
    if (name === "get" && parts.length === 1) return "${" + parts[0] + "}";
    if (name === "calc" && parts.length === 1) return "${math " + values[0] + "}";
    if (name === "set" && parts.length === 2) {
      const value =
        parts[1].startsWith("${") && parts[1].endsWith("}") ? values[1] : argument(values[1]);
      return "${set " + parts[0] + " " + value + "}";
    }
    if (name === "if" && parts.length === 3)
      return "${if " + values[0] + "}" + values[1] + "${else}" + values[2] + "${end}";
    if (
      [
        "stat",
        "addstat",
        "setstat",
        "top",
        "same",
        "args",
        "game",
        "title",
        "link",
        "uptime",
        "live",
      ].includes(name)
    )
      return "${" + name + " " + values.map(argument).join(" ") + "}";
    throw Error("Review the old " + name + " function before saving this command.");
  }
  function walk(text) {
    let output = "";
    for (let i = 0; i < text.length;) {
      if (text[i] === "\\") {
        output += text[i++] + (text[i++] || "");
        continue;
      }
      if (!text.startsWith("${", i)) {
        output += text[i++];
        continue;
      }
      let end = i + 2,
        depth = 1;
      const legacy = /^[a-z][a-z0-9.]*\[/i.test(text.slice(end));
      let quoted = "";
      for (; end < text.length && depth; end++) {
        const ch = text[end];
        if (ch === "\\") {
          end++;
          continue;
        }
        if (quoted) {
          if (ch === quoted) quoted = "";
          continue;
        }
        if (!legacy && (ch === '"' || ch === "'")) {
          quoted = ch;
          continue;
        }
        if (text.startsWith("${", end)) {
          depth++;
          end++;
        } else if (ch === "}") depth--;
      }
      if (depth) throw Error("Close every variable with }.");
      output += expression(text.slice(i + 2, end - 1));
      i = end;
    }
    return output;
  }
  const result = walk(source);
  return usesDuel === 1
    ? result.replace(firstDuel.guarded, firstDuel.plain)
    : usesDuel
      ? "${set migratedDuel 0}" + result
      : result;
}
module.exports = { modernize };
