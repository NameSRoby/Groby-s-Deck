const compile = function compile(source) {
  if (typeof source !== "string" || source.length > 12000)
    throw Error("Keep commands under 12,000 characters.");
  const names = new Map(),
    builtins = new Set([
      "sender",
      "user",
      "channel",
      "viewers",
      "bits",
      "months",
      "gifts",
      "command",
      "role",
      "raider",
      "event",
      "args",
      "game",
      "title",
      "link",
      "uptime",
      "live",
      "time",
      "date",
      "unix",
    ]);
  let operations = 0;
  const call = (name, args) => "${" + name + "[" + args.join("|") + "]}";
  const reference = (name) =>
    names.has(name) ? call("get", [names.get(name)]) : "${" + name + "}";
  const args = require("./variable-arguments");
  function literal(text) {
    return (text.startsWith('"') || text.startsWith("'")) && text.at(-1) === text[0];
  }
  const unquote = (text) => text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  const player = (text) =>
    names.has(text) || builtins.has(text) || literal(text) || text.startsWith("${")
      ? value(text)
      : text;
  function math(text) {
    const values = [];
    const protect = (value) => "@@" + (values.push(value) - 1) + "@@";
    let expression = "";
    for (let i = 0; i < text.length;) {
      if (!text.startsWith("${", i)) {
        expression += text[i++];
        continue;
      }
      let end = i + 2,
        depth = 1;
      for (; end < text.length && depth; end++) {
        if (text.startsWith("${", end)) {
          depth++;
          end++;
        } else if (text[end] === "}") depth--;
      }
      if (depth) throw Error("Close every variable with }.");
      expression += protect(variable(text.slice(i + 2, end - 1)));
      i = end;
    }
    expression = expression.replace(/[a-z][a-z0-9_.]*/gi, (word, offset) => {
      if (word === "true" || word === "false") return word;
      if (
        ["min", "max", "abs", "round", "floor", "ceil", "clamp"].includes(word) &&
        /^\s*\(/.test(expression.slice(offset + word.length))
      )
        return word;
      if (names.has(word) || builtins.has(word)) return protect(reference(word));
      throw Error("Unknown value " + word + ". Use ${set " + word + " value} first.");
    });
    return expression.replace(/@@(\d+)@@/g, (_, index) => values[Number(index)]);
  }
  function value(text) {
    text = text.trim();
    if (literal(text)) return walk(unquote(text));
    if (/^(count|readcount|resetcount)[a-z0-9]/i.test(text)) return variable(text);
    if (names.has(text) || builtins.has(text)) return reference(text);
    if (text === "boards") return variable(text);
    if (
      /^(random\.|(?:random|stat|math|same|username|game|title|link|uptime|live|args|top|chance|weighted|addcount|setcount|board|boards) )/.test(
        text,
      )
    )
      return variable(text);
    if (text.startsWith("${") && text.endsWith("}")) return walk(text);
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return text;
    return call("calc", [math(text)]);
  }
  function variable(body) {
    if (++operations > 512) throw Error("Use at most 512 variables.");
    if (/^[a-z][a-z0-9.]*\[/.test(body))
      throw Error("Use the current command syntax; convert this saved command before running it.");
    const assignment = /^set ([a-z][a-z0-9_]{0,31}) (.+)$/is.exec(body);
    if (assignment) {
      const [, name, input] = assignment;
      if (
        builtins.has(name) ||
        ["if", "else", "end", "recipe_source"].includes(name) ||
        /^(readcount|resetcount|count)/.test(name)
      )
        throw Error("Choose a name other than " + name + ".");
      const content = value(input);
      if (!names.has(name)) names.set(name, "v" + names.size);
      return call("set", [names.get(name), content]);
    }
    if (names.has(body)) return reference(body);
    const compactCounter = /^(count|readcount|resetcount)([a-z0-9][a-z0-9 _-]{0,63})$/i.exec(body);
    if (compactCounter) {
      const [, operation, key] = compactCounter;
      const mode = operation.toLowerCase();
      return call(mode === "count" ? "count" : mode === "readcount" ? "getcount" : "setcount", [
        key.trim(),
        ...(mode === "resetcount" ? ["0"] : []),
      ]);
    }
    const parts = args(body),
      name = parts.shift();
    const goalArgs = args.goal(name, parts);
    if (goalArgs) {
      return call(
        name,
        goalArgs.map((part) =>
          part.startsWith("${") ? walk(part) : literal(part) ? unquote(part) : part,
        ),
      );
    }
    if (["addcount", "setcount"].includes(name) && parts.length === 2 && !body.includes("["))
      return call(name, [literal(parts[0]) ? unquote(parts[0]) : parts[0], value(parts[1])]);
    if (name === "random" && parts.length === 2) return call("random", parts.map(value));
    if (["random.pick", "chance", "weighted"].includes(name)) {
      const options = parts.map((part, index) =>
        name === "chance" && index === 0
          ? value(part)
          : literal(part)
            ? walk(unquote(part))
            : walk(part),
      );
      return call(name === "random.pick" ? "pick" : name, options);
    }
    if (name === "same" && parts.length === 2) return call("same", parts.map(player));
    if (name === "username" && parts.length === 1) {
      if (/^(?:[1-9]|1\d|20)$/.test(parts[0])) return call("username", ["${" + parts[0] + "}"]);
      return call("username", [player(parts[0])]);
    }
    if (["stat", "addstat", "setstat"].includes(name) && !body.includes("[")) {
      if (parts.length < 2 || parts.length > 3)
        throw Error("Use ${" + name + " player field" + (name === "stat" ? "}" : " amount}"));
      return call(name, [player(parts[0]), parts[1], ...parts.slice(2).map(value)]);
    }
    if (name === "top" && parts.length && !body.includes("[")) return call("top", parts);
    const simpleValue = {
      __proto__: null,
      args: () => parts.length === 1 && call("args", parts),
      math: () => call("calc", [math(body.slice(5))]),
      resetstats: () =>
        parts.length >= 1 &&
        parts.length <= 2 &&
        call(name, [parts[0], parts[1] === undefined ? "0" : value(parts[1])]),
      saveboard: () =>
        parts.length === 3 && call(name, [player(parts[0]), parts[1], value(parts[2])]),
      board: () => parts.length === 1 && call(name, [player(parts[0])]),
      boards: () => parts.length <= 1 && call(name, parts.length ? [value(parts[0])] : ["5"]),
    }[name]?.();
    if (simpleValue) return simpleValue;
    if (["add", "subtract", "limit", "round"].includes(name) && parts.length) {
      const target = parts[0];
      if (!names.has(target)) throw Error("Use ${set " + target + " value} first.");
      let expression;
      if (name === "round" && parts.length === 1) expression = "round(" + reference(target) + ")";
      else if (name === "limit" && parts.length === 3)
        expression =
          "clamp(" + reference(target) + "," + math(parts[1]) + "," + math(parts[2]) + ")";
      else if (["add", "subtract"].includes(name) && parts.length >= 2)
        expression =
          reference(target) +
          (name === "add" ? "+" : "-") +
          "(" +
          math(parts.slice(1).join(" ")) +
          ")";
      else throw Error("Check the options for ${" + name + "}.");
      return call("set", [names.get(target), call("calc", [expression])]);
    }
    if (
      ["game", "title", "link", "uptime", "live"].includes(name) &&
      parts.length === 1 &&
      !body.includes("[")
    )
      return call(name, [player(parts[0])]);
    if ((builtins.has(body) || /^(?:[1-9]|1\d|20)$/.test(body)) && parts.length === 0)
      return "${" + body + "}";
    throw Error("Unknown function or value: " + body + ". Use the Variables reference.");
  }
  function walk(text) {
    const frames = [{ yes: [], no: [], branch: "yes" }];
    const emit = (part) => frames.at(-1)[frames.at(-1).branch].push(part);
    const emitText = (part) => {
      const text = part.replace(/\s+/g, " ");
      emit(/[|{}]/.test(text) ? call("literal", [encodeURIComponent(text)]) : text);
    };
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf("${", cursor);
      if (start < 0) {
        emitText(text.slice(cursor));
        break;
      }
      if (start > 0 && text[start - 1] === "\\") {
        emitText(text.slice(cursor, start - 1));
        let end = start + 2,
          depth = 1;
        for (; end < text.length && depth; end++) {
          if (text.startsWith("${", end)) {
            depth++;
            end++;
          } else if (text[end] === "}") depth--;
        }
        emit(call("literal", [encodeURIComponent(text.slice(start, end))]));
        cursor = end;
        continue;
      }
      emitText(text.slice(cursor, start));
      let end = start + 2,
        depth = 1,
        quote = "";
      for (; end < text.length && depth; end++) {
        const char = text[end];
        if (char === "\\") {
          end++;
          continue;
        }
        if (quote) {
          if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (text.startsWith("${", end)) {
          depth++;
          end++;
        } else if (char === "}") depth--;
      }
      if (depth) throw Error("Close every variable with }.");
      const body = text.slice(start + 2, end - 1).trim();
      try {
        if (body.startsWith("if ")) {
          const options = args(body.slice(3));
          const condition = (text) =>
            /^same\s/.test(text) ? variable(text) : call("calc", [math(text)]);
          if (literal(options.at(-1) || "") && options[0] !== "same")
            throw Error("Use ${if condition}, ${else} and ${end} for every choice.");
          if (frames.length > 3) throw Error("Use at most three nested if blocks.");
          frames.push({ condition: condition(body.slice(3)), yes: [], no: [], branch: "yes" });
        } else if (body === "else") {
          if (frames.length === 1 || frames.at(-1).branch === "no")
            throw Error("${else} needs ${if condition} above it.");
          frames.at(-1).branch = "no";
        } else if (body === "end") {
          if (frames.length === 1) throw Error("No ${if} block to close.");
          const frame = frames.pop();
          emit(call("if", [frame.condition, frame.yes.join(""), frame.no.join("")]));
        } else emit(variable(body));
      } catch (error) {
        throw Error("Line " + text.slice(0, start).split("\n").length + ": " + error.message);
      }
      cursor = end;
    }
    if (frames.length !== 1) throw Error("Close each ${if condition} with ${end}.");
    return frames[0].yes.join("");
  }
  const result = walk(source);
  if (result.length > 16384) throw Error("This command has too many steps.");
  return result;
};
const modernize = require("./syntax-migration").modernize;
module.exports=require('./variable-recipe-storage')(compile, modernize);
