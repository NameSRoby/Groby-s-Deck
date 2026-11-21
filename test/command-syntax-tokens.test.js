const test = require("node:test"),
  assert = require("node:assert/strict");
const tokens = require("../src/domains/twitch/command-syntax-tokens")(
  require("../src/domains/twitch/command-variable-guide"),
);
test("command colors distinguish language tokens while preserving every source byte", () => {
  const source =
    'Hello ${sender}! ${set roll random.1-20}\n${if roll >= 16}${random.pick "Hit ${user}!" "Miss"}${else}${countdeaths}${end}';
  const result = tokens(source);
  assert.equal(result.map((row) => row.text).join(""), source);
  const has = (kind, text) =>
    assert.ok(
      result.some((row) => row.kind === kind && row.text === text),
      text,
    );
  has("text", "Hello ");
  has("variable", "sender");
  has("function", "set");
  has("variable", "roll");
  has("function", "random");
  has("number", "20");
  has("flow", "if");
  has("operator", ">=");
  has("number", "16");
  has("function", "random.pick");
  has("string", '"Hit ');
  has("variable", "user");
  has("function", "countdeaths");
  has("flow", "else");
  has("flow", "end");
  for (const text of [
    "",
    "${",
    '${random.pick "unfinished',
    "\\${sender}",
    '${set text "a } b"}',
    "${math -2 + floor(3.5)}",
    "${if a != 1 && b <= 2 || !false}",
    "x".repeat(30000),
  ])
    assert.equal(
      tokens(text)
        .map((row) => row.text)
        .join(""),
      text,
    );
  assert.ok(tokens("\\${sender}").every((row) => row.kind === "text"));
  assert.equal(tokens("x".repeat(30000)).length, 1);
});
