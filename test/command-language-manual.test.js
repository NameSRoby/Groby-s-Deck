const test = require("node:test"),
  assert = require("node:assert/strict");
const groups = require("../src/domains/twitch/command-language-manual"),
  { render } = require("../src/domains/twitch/command-template");

test("every worked operator and arithmetic example in the manual agrees with the real command renderer", async () => {
  for (const group of groups)
    for (const row of group.rows)
      for (const [expression, expected] of row.cases) {
        assert.equal(await render("${math " + expression + "}"), String(expected), expression);
        if (!group.numeric)
          assert.equal(
            await render("${if " + expression + "}Yes${else}No${end}"),
            expected ? "Yes" : "No",
            expression,
          );
      }
  await assert.rejects(render("${math 9 / 0}"), /outside the supported range/);
  assert.equal(
    await render('${if same ${1} "confirm"}Yes${else}No${end}', { context: { argv: ["CONFIRM"] } }),
    "Yes",
  );
  assert.equal(await render("${set roll 18}${roll}"), "18");
  await assert.rejects(render("${set roll 18}${Roll}"), /Unknown/);
});
