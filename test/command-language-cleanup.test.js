const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  source = require("../src/domains/twitch/command-source"),
  { render } = require("../src/domains/twitch/command-template");

test("retired spellings convert once; the compiler accepts only canonical operations", async () => {
  for (const [old, current] of [
    ["${target}", "${user}"],
    ["${opponent}", "${username 1}"],
    ["${target.game}", "${game user}"],
    ["${random.1-20}", "${random 1 20}"],
    ["${random}", "${random 1 100}"],
    ["${random[1|20]}", "${random 1 20}"],
    ["${pick[Hello|Bye]}", '${random.pick "Hello" "Bye"}'],
    ['${if 1 == 1 "Yes" "No"}', "${if 1 == 1}Yes${else}No${end}"],
    ["{raider}", "${raider}"],
    ["${setcount score 0}", "${resetcountscore}"],
    ["${set[roll|${random[1|20]}]}${get[roll]}", "${set roll ${random 1 20}}${roll}"],
  ]) {
    const next = source.canonical(old);
    assert.equal(next, current);
    assert.equal(source.canonical(next), next, "conversion is idempotent");
    if (old.startsWith("${") && old !== "${setcount score 0}")
      assert.throws(() => source.compile(old), /syntax|Unknown|every choice/, old);
  }
  const dynamic = "${set sides 6}${set minimum 2}${random minimum sides}";
  assert.equal(await render(dynamic, { random: () => 0.99 }), "6");
  assert.equal(
    source.canonical('\\${target} ${set value "target random.1-20"}${value}'),
    '\\${target} ${set value "target random.1-20"}${value}',
  );
  assert.equal(source.canonical("Literal \\{user}"), "Literal \\{user}");
  let changes = 0;
  assert.equal(
    await render('Literal: \\${random.pick "${countbad}" "Bye"}', {
      counter: () => ++changes,
    }),
    'Literal: ${random.pick "${countbad}" "Bye"}',
  );
  assert.equal(changes, 0);
});

test("retired fight calls become editable generic recipes, with one result and no self progress", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-clean-duel-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = require("../src/domains/twitch/command-counters")(path.join(root, "values.json")),
    old = "${fight[${1}|Death]} Same roll: ${fight.roll}. Winner: ${fight.winner}",
    next = source.canonical(old);
  assert.doesNotMatch(next, /\$\{fight(?:[.\[}]|stats|top)/);
  const counter = owner("owner", false, true);
  const text = await render(next, {
    context: { sender: "hero", argv: ["rival"] },
    counter,
    random: () => 0.99,
  });
  assert.match(text, /Same roll: 20\. Winner: hero/);
  assert.equal(counter("player hero wins", "get"), 1);
  assert.equal(counter("player hero xp", "get"), 49);
  const self = owner("owner", false, true);
  assert.match(
    await render(next, { context: { sender: "hero", argv: ["@HERO"] }, counter: self }),
    /No XP/,
  );
  assert.equal(self.has("player hero xp"), false);
  const lazy = source.canonical("${if false}${fight.roll}${else}Safe${end}");
  let draws = 0;
  assert.equal(
    await render(lazy, {
      random: () => {
        draws++;
        return 0;
      },
    }),
    "Safe",
  );
  assert.equal(draws, 0);
});

test("retired player records import into generic storage once without overwriting current fields or seasons", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-player-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "automations.json"),
    target = file.replace(".json", ".counters.json"),
    old = file.replace(".json", ".duels.json"),
    prior = { version: 2, values: { "owner:player hero xp": 99, "owner:season": 2 }, boards: {} };
  fs.writeFileSync(target, JSON.stringify(prior));
  fs.writeFileSync(
    old,
    JSON.stringify({
      "owner:hero": {
        login: "hero",
        wins: 2,
        losses: 1,
        xp: 29,
        rating: 1010,
        streak: 1,
        lastAt: 1,
      },
    }),
  );
  const migrate = require("../src/domains/twitch/command-player-migration");
  migrate(file);
  const next = JSON.parse(fs.readFileSync(target));
  assert.equal(next.values["owner:player hero xp"], 99);
  assert.equal(next.values["owner:player hero wins"], 2);
  assert.equal(next.values["owner:season"], 2);
  assert.deepEqual(next.boards, {});
  assert.deepEqual(
    JSON.parse(fs.readFileSync(target.replace(".json", ".syntax-backup.json"))),
    prior,
  );
  assert.equal(fs.existsSync(old), false);
  const before = fs.readFileSync(target, "utf8");
  migrate(file);
  assert.equal(fs.readFileSync(target, "utf8"), before);
});

test("every shipped command, game stage and season recipe uses current syntax without transport encoding", () => {
  const presets = require("../src/domains/twitch/command-presets");
  for (const preset of presets)
    assert.equal(source.canonical(preset.message), preset.message, preset.id);
  for (const name of ["d20-arena", "seasons"]) {
    const recipe = require("../public/core/recipes/" + name + ".json");
    const text = recipe.stages.map((stage) => stage.source).join("\n\n");
    assert.equal(source.canonical(text), text);
  }
  const worker = require("../features/twitch-integration/dist/variable-recipe");
  assert.equal(worker.pack, undefined);
  const text = "${set roll random 1 20}Roll: ${roll}";
  assert.equal(worker.canonical(text), text);
  assert.equal(require("../features/twitch-integration/dist/counter-syntax").encode, undefined);
});

test("deck startup and Save normalize nested command fields while preserving colors, holds and unrelated text", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-deck-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "system/control-deck.json");
  const config = require("../src/domains/control-deck/control-deck-config").validate({
    version: 1,
    mode: "deck",
    columns: 5,
    pages: [
      {
        id: "main",
        name: "Main",
        buttons: [
          {
            id: "button",
            title: "Reply",
            kind: "macro",
            appearance: { color: "#00aaff" },
            steps: [
              {
                type: "sequence",
                steps: [{ actionId: "twitch.action.chat", params: { message: "${target}" } }],
              },
            ],
            holdSteps: [
              { actionId: "twitch.action.announcement", params: { message: "${random[1|20]}" } },
            ],
          },
        ],
      },
    ],
  });
  const saved = { version: 1, revision: 7, audioPageAdded: true, config };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved));
  let executions = 0;
  const create = require("../src/domains/control-deck/control-deck.service"),
    options = {
      runtimeDir: root,
      actions: { catalog: () => [], execute: () => executions++ },
    };
  const deck = create(options),
    next = deck.snapshot();
  assert.equal(next.revision, 8);
  const button = next.config.pages[0].buttons[0];
  assert.equal(button.appearance.color, "#00aaff");
  assert.equal(button.steps[0].steps[0].params.message, "${user}");
  assert.equal(button.holdSteps[0].params.message, "${random 1 20}");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(file.replace(".json", ".syntax-backup.json"))),
    saved,
  );
  button.holdSteps[0].params.message = "${target.link}";
  const changed = deck.save(next.config, next.revision);
  assert.equal(changed.config.pages[0].buttons[0].holdSteps[0].params.message, "${link user}");
  await deck.shutdown();
  const restarted = create(options);
  assert.equal(restarted.snapshot().revision, changed.revision);
  await restarted.shutdown();
  assert.equal(executions, 0);
  assert.equal(
    require("../src/domains/twitch/command-source-fields").messages({
      actionId: "native.example",
      params: { message: "${target}" },
    }).params.message,
    "${target}",
  );
});
