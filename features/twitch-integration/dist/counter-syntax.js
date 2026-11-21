/** Normalize authored command fields at the feature boundary; send readable source only. */
function display(text) {
  return require("./variable-recipe").canonical(text);
}
function fields(value, transform, key = "", depth = 0) {
  if (depth > 40) throw Error("Command data is nested too deeply.");
  if (typeof value === "string")
    return ["message", "template", "syntax"].includes(key) ? transform(value) : value;
  if (Array.isArray(value)) return value.map((item) => fields(item, transform, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, fields(item, transform, name, depth + 1)]),
    );
  return value;
}
module.exports = { display, fields };
