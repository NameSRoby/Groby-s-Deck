/** Presentation only: tokenize incomplete authored text without evaluating it. */
module.exports = function createCommandTokenizer(catalog) {
  const functions = new Set([
    "min",
    "max",
    "abs",
    "round",
    "floor",
    "ceil",
    "clamp",
    ...catalog
      .filter((row) => row.syntax.includes(" "))
      .map((row) => row.syntax.slice(2).split(/\s/)[0]),
  ]);
  const flow = new Set(["if", "else", "end"]);
  return function commandTokens(source) {
    source = String(source);
    if (source.length > 24000) return [{ kind: "text", text: source }];
    const output = [],
      frames = [];
    const emit = (kind, text) => {
      if (output.at(-1)?.kind === kind) output.at(-1).text += text;
      else output.push({ kind, text });
    };
    let i = 0;
    while (i < source.length) {
      if (output.length >= 6000) {
        emit("text", source.slice(i));
        break;
      }
      const frame = frames.at(-1),
        char = source[i];
      if (char === "\\") {
        const size = source.startsWith("\\${", i) ? 3 : 2;
        emit(frame?.quote ? "string" : "text", source.slice(i, i + size));
        i += size;
        continue;
      }
      if (source.startsWith("${", i)) {
        emit("bracket", "${");
        frames.push({ quote: "" });
        i += 2;
        continue;
      }
      if (!frame) {
        const end = source.slice(i).search(/[\\$]/);
        const length = end > 0 ? end : 1;
        emit("text", source.slice(i, i + length));
        i += length;
        continue;
      }
      if (frame.quote) {
        emit("string", char);
        if (char === frame.quote) frame.quote = "";
        i++;
        continue;
      }
      if (char === "'" || char === '"') {
        frame.quote = char;
        emit("string", char);
        i++;
        continue;
      }
      if (char === "}") {
        frames.pop();
        emit("bracket", char);
        i++;
        continue;
      }
      const rest = source.slice(i);
      const number = /^\d+(?:\.\d+)?/.exec(rest);
      if (number) {
        emit("number", number[0]);
        i += number[0].length;
        continue;
      }
      const word = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*/i.exec(rest);
      if (word) {
        const name = word[0];
        emit(
          flow.has(name)
            ? "flow"
            : functions.has(name) ||
                /^(?:count|readcount|resetcount)[a-z0-9]/i.test(name) ||
                name === "random"
              ? "function"
              : ["true", "false"].includes(name)
                ? "number"
                : "variable",
          name,
        );
        i += name.length;
        continue;
      }
      const operator = /^(?:==|!=|>=|<=|&&|\|\||[+*/%<>!\-])/.exec(rest);
      if (operator) {
        emit("operator", operator[0]);
        i += operator[0].length;
        continue;
      }
      emit(/[()[\],.|]/.test(char) ? "bracket" : "text", char);
      i++;
    }
    return output;
  };
};
