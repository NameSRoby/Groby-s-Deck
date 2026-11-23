const savedCounters = require("./support/counter-snapshot.cjs");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const variables = require("../features/twitch-integration/dist/variable-recipe"),
  arena = require("../src/domains/twitch/command-arena-variables"),
  { render } = require("../src/domains/twitch/command-template");

test("line breaks separate generated words across conditions and reusable local values", async () => {
  const text = await render(
    '${set who sender}\n${if 1 == 1}SUCCESS!${end}\n${who} wins.\n${random.pick "Well played." "Nice roll."}',
    { context: { sender: "hero" }, random: () => 0 },
  );
  assert.equal(text, "SUCCESS! hero wins. Well played.");
});
test("Canonical arena preserves all twenty outcomes and records across conversion", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-variables-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stores = ["old", "variables"].map((name) =>
    require("../src/domains/twitch/command-counters")(path.join(root, name + ".json")),
  );
  for (let n = 0; n < 60; n++) {
    const roll = (n % 20) + 1,
      context = { sender: n % 2 ? "hero" : "rival", argv: [n % 2 ? "rival" : "hero"] };
    for (let j = 0; j < 2; j++) {
      const counter = stores[j]("owner", false, true);
      const text = await render(j ? variables.canonical(arena.message) : arena.message, {
        context,
        counter,
        random: () => (roll - 0.5) / 20,
      });
      assert.match(text, new RegExp("ROLLED: .* rolled " + roll + "/20"));
      if (j) assert.equal(text.includes("\n"), false);
      counter.commit();
    }
    assert.deepEqual(
      JSON.parse(savedCounters(path.join(root, "old.json"))),
      JSON.parse(savedCounters(path.join(root, "variables.json"))),
    );
  }
});
test("Command storage keeps only readable source and decodes old envelopes once", async () => {
  const packed = variables.canonical(arena.message);
  assert.ok(packed.length <= 16384);
  assert.equal(variables.unpack(packed), arena.message);
  const syntax = require("../features/twitch-integration/dist/counter-syntax");
  assert.equal(syntax.display(syntax.display(arena.message)), arena.message);
  const simple =
    "${set roll random.1-20}${if roll >= 16}${sender} wins with ${roll}!${else}Try again!${end}";
  assert.equal(
    await render(variables.canonical(simple), { context: { sender: "hero" }, random: () => 0.99 }),
    "hero wins with 20!",
  );
  const count = "${set total 4}Deaths: ${countadddeath}; bonus ${total}";
  assert.equal(syntax.display(syntax.display(count)), count);
  assert.equal(variables.canonical(packed), arena.message);
  const original = "${set score 16}Score: ${score}";
  const previous =
    "${set[recipe_source|" +
    require("node:zlib").deflateRawSync(original).toString("base64") +
    "]}${set[score|16]}Score: ${get[score]}";
  assert.equal(variables.unpack(previous), original);
});

test("self-fights accept plain names or @names and never save any progress", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-self-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "records.json"),
    owner = require("../src/domains/twitch/command-counters")(file);
  for (let n = 0; n < 20; n++) {
    const counter = owner("123", false, true);
    const text = await render(variables.canonical(arena.message), {
      context: { sender: "Viewer", argv: [n % 2 ? "@VIEWER" : "viewer"] },
      counter,
      random: () => n / 20,
    });
    assert.match(text, /Viewer/);
    assert.match(text, /NEED: \d+\+ on a D20.*ROLLED: Viewer rolled \d+\/20/);
    assert.match(text, /No XP, wins, losses or rating changes/);
    counter.commit();
    assert.equal(counter.has("player viewer xp"), false);
  }
  assert.equal(fs.existsSync(file), false);
  const seed = owner("123", false, true);
  seed("player viewer xp", "set", 100);
  seed.commit();
  const before = savedCounters(file),
    counter = owner("123", false, true);
  await render(variables.canonical(arena.message), {
    context: { sender: "Viewer", argv: ["@viewer"] },
    counter,
  });
  counter.commit();
  assert.equal(savedCounters(file), before);
});
test("Variable command errors point to a line and reject code, missing names and unclosed conditions", () => {
  assert.throws(() => variables.compile("${set score missing + 1}"), /Unknown value missing/);
  assert.throws(() => variables.compile("${if 1 == 1}Hello"), /end/);
  assert.throws(() => variables.compile("${else}"), /else.*needs/);
  assert.throws(() => variables.compile("${set sender 1}"), /Choose a name/);
});
test("losing a duel preserves the loser's wins and deducts XP without awarding participation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-loss-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = require("../src/domains/twitch/command-counters")(path.join(root, "records.json"));
  const counter = owner("owner", false, true);
  counter("player hero wins", "set", 7);
  counter("player rival wins", "set", 3);
  counter("player hero xp", "set", 100);
  const text = await render(variables.canonical(arena.message), {
    context: { sender: "hero", argv: ["rival"] },
    counter,
    random: () => 0.35,
  });
  assert.equal(counter("player hero wins", "get"), 7);
  assert.equal(counter("player rival wins", "get"), 4);
  assert.equal(counter("player hero losses", "get"), 1);
  assert.equal(counter("player hero xp", "get"), 90);
  assert.match(
    text,
    /NEED: 16\+.*ROLLED: hero rolled 8\/20.*FAILED.*RESULT: rival wins.*hero loses \(-10 XP\)/,
  );
  assert.doesNotMatch(text, /surviving|participation|Level/);
});

test("arena narration covers every scene, keeps one die roll and fits Twitch chat", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-scenes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = require("../src/domains/twitch/command-counters")(path.join(root, "records.json"));
  const selfScenes = new Set();
  for (const self of [false, true]) {
    for (const roll of [1, 2, 15, 16, 19, 20]) {
      for (let choice = 0; choice < 10; choice++) {
        let draws = 0;
        const counter = store("owner", false, true);
        const text = await render(variables.canonical(arena.message), {
          context: { sender: "hero", argv: [self ? "hero" : "rival"] },
          counter,
          random: () => (++draws === 1 ? (roll - 0.5) / 20 : (choice + 0.5) / 10),
        });
        assert.equal(draws, 2, "one die and one chosen scene; unchosen scenes stay lazy");
        assert.ok(text.length <= 500);
        assert.match(text, new RegExp("NEED: 16\\+ on a D20.*ROLLED: hero rolled " + roll + "/20"));
        assert.doesNotMatch(text, /\$\{|undefined/);
        if (self) {
          selfScenes.add(text.slice(text.indexOf("!", text.indexOf("ROLLED:")) + 1));
          counter.commit();
          assert.equal(fs.existsSync(path.join(root, "records.json")), false);
        } else {
          const winner = roll >= 16 ? "hero" : "rival",
            loser = roll >= 16 ? "rival" : "hero";
          assert.ok(counter(`player ${winner} xp`, "get") >= 15);
          assert.equal(counter(`player ${loser} xp`, "get"), 0);
        }
      }
    }
  }
  assert.equal(selfScenes.size, 10);
});

test("quoted choices, inline conditions and legacy templates stay lazy and compatible", async () => {
  assert.equal(
    await render('${set roll random.1-20}${if roll >= 16 "${sender} wins" "Try again"}', {
      context: { sender: "hero" },
      random: () => 0.99,
    }),
    "hero wins",
  );
  assert.equal(
    await render('${random.pick "Hello ${sender}" "Good luck"}', {
      context: { sender: "hero" },
      random: () => 0,
    }),
    "Hello hero",
  );
  assert.equal(await render('${chance 100 "Yes" "${countunused}"}', { random: () => 0 }), "Yes");
  assert.equal(await render("${if[1|You aren't late!|Oops]}"), "You aren't late!");
  assert.equal(await render("Literal: \\${random.1-20}"), "Literal: ${random.1-20}");
});

test("example presets use the same variable syntax and plain replies preserve viewer text", async () => {
  for (const preset of require("../src/domains/twitch/command-presets")) {
    const text = await render(variables.canonical(preset.message), {
      context: { sender: "hero", user: "rival", channel: "owner", argv: ["rival"] },
      lookup: async () => ({ game: "Music", title: "Hello", live: true, startedAt: Date.now() }),
      random: () => 0.8,
    });
    assert.ok(text.length > 0 && text.length <= 500, preset.id);
  }
  const malicious = "${countnever}";
  assert.equal(
    await render("Input: ${args}", { context: { argv: [malicious] } }),
    "Input: " + malicious,
  );
  assert.equal(
    await render('${random.pick "He said \\"Hi\\"" "Bye"}', { random: () => 0 }),
    'He said "Hi"',
  );
});
