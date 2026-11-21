/** Split quoted variable arguments without evaluating nested expressions. */
function args(text) {
  const values = [];
  let value = "",
    quote = "",
    depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length) {
      value += char + text[++i];
      continue;
    }
    if (quote) {
      value += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      value += char;
      continue;
    }
    if (text.startsWith("${", i)) {
      depth++;
      value += "${";
      i++;
      continue;
    }
    if (char === "}" && depth) depth--;
    if (/\s/.test(char) && !depth) {
      if (value) values.push(value);
      value = "";
    } else value += char;
  }
  if (quote || depth) throw Error("Close each quoted option and variable.");
  if (value) values.push(value);
  return values;
}
module.exports = args;
